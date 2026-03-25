"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
class ApiClient {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    async *streamChat(messages, model, maxTokens, temperature, onAbort) {
        const isAnthropicFormat = model.startsWith("claude");
        let path = "/chat/completions";
        let bodyObj = {
            model,
            max_tokens: maxTokens,
            temperature,
            stream: true,
        };
        if (isAnthropicFormat) {
            path = "/messages";
            const anthropicMsg = [];
            for (const m of messages) {
                if (m.role === "system") {
                    bodyObj.system = m.content;
                }
                else {
                    anthropicMsg.push(m);
                }
            }
            bodyObj.messages = anthropicMsg;
        }
        else {
            bodyObj.messages = messages;
        }
        const url = new url_1.URL(`${this.baseUrl}${path}`);
        const body = JSON.stringify(bodyObj);
        const isHttps = url.protocol === "https:";
        const lib = isHttps ? https : http;
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
            "Accept": "text/event-stream",
            "Content-Length": Buffer.byteLength(body),
        };
        if (isAnthropicFormat) {
            headers["x-api-key"] = this.apiKey;
            headers["anthropic-version"] = "2023-06-01";
        }
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers,
        };
        yield* await new Promise((resolve, reject) => {
            let aborted = false;
            const req = lib.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errBody = "";
                    res.on("data", (d) => errBody += d.toString());
                    res.on("end", () => {
                        reject(new Error(`API Error ${res.statusCode}: ${errBody}`));
                    });
                    return;
                }
                async function* gen() {
                    let buffer = "";
                    for await (const chunk of res) {
                        if (aborted) {
                            yield { delta: "", done: true };
                            return;
                        }
                        buffer += chunk.toString("utf8");
                        const lines = buffer.split("\n");
                        buffer = lines.pop() ?? "";
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith("data:"))
                                continue;
                            const data = trimmed.slice(5).trim();
                            if (data === "[DONE]") {
                                yield { delta: "", done: true };
                                return;
                            }
                            try {
                                const parsed = JSON.parse(data);
                                if (isAnthropicFormat) {
                                    if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                                        yield { delta: parsed.delta.text, done: false };
                                    }
                                }
                                else {
                                    const delta = parsed?.choices?.[0]?.delta?.content;
                                    if (delta) {
                                        yield { delta, done: false };
                                    }
                                }
                            }
                            catch {
                                // skip malformed SSE lines
                            }
                        }
                    }
                    yield { delta: "", done: true };
                }
                resolve(gen());
            });
            req.on("error", (err) => reject(err));
            if (onAbort) {
                onAbort(() => {
                    aborted = true;
                    req.destroy();
                });
            }
            req.write(body);
            req.end();
        });
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=apiClient.js.map