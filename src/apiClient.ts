import * as https from "https";
import * as http from "http";
import { URL } from "url";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | any[];
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  error?: string;
}

export class ApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    maxTokens: number,
    temperature: number,
    onAbort?: (abort: () => void) => void
  ): AsyncGenerator<StreamChunk> {
    const isAnthropicFormat = model.startsWith("claude");
    
    let path = "/chat/completions";
    let bodyObj: any = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    if (isAnthropicFormat) {
      path = "/messages";
      const anthropicMsg: any[] = [];
      for (const m of messages) {
        if (m.role === "system") {
          bodyObj.system = m.content;
        } else {
          anthropicMsg.push(m);
        }
      }
      bodyObj.messages = anthropicMsg;
    } else {
      bodyObj.messages = messages;
    }

    const url = new URL(`${this.baseUrl}${path}`);
    const body = JSON.stringify(bodyObj);

    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "Accept": "text/event-stream",
      "Content-Length": Buffer.byteLength(body),
    };
    
    if (isAnthropicFormat) {
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers,
    };

    yield* await new Promise<AsyncGenerator<StreamChunk>>((resolve, reject) => {
      let aborted = false;

      const req = lib.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (d: Buffer) => errBody += d.toString());
          res.on("end", () => {
            reject(new Error(`API Error ${res.statusCode}: ${errBody}`));
          });
          return;
        }

        async function* gen(): AsyncGenerator<StreamChunk> {
          let buffer = "";
          for await (const chunk of res) {
            if (aborted) {
              yield { delta: "", done: true };
              return;
            }
            buffer += (chunk as Buffer).toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data:")) continue;
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
                } else {
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (delta) {
                    yield { delta, done: false };
                  }
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }
          yield { delta: "", done: true };
        }

        resolve(gen());
      });

      req.on("error", (err: Error) => reject(err));

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
