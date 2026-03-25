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
exports.OpenClaudeViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const apiClient_1 = require("./apiClient");
const models_1 = require("./models");
const path = __importStar(require("path"));
class OpenClaudeViewProvider {
    constructor(_context) {
        this._context = _context;
        this._messages = [];
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };
        webviewView.webview.html = this._getHtmlContent(webviewView.webview);
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "sendMessage":
                    await this._handleSendMessage(msg.text, msg.model);
                    break;
                case "stopGeneration":
                    if (this._abortFn) {
                        this._abortFn();
                        this._abortFn = undefined;
                    }
                    break;
                case "clearChat":
                    this._messages = [];
                    this._postMessage({ type: "cleared" });
                    break;
                case "insertCode":
                    this._insertCodeToEditor(msg.code);
                    break;
                case "copyCode":
                    vscode.env.clipboard.writeText(msg.code);
                    vscode.window.showInformationMessage("Code copied to clipboard!");
                    break;
                case "openSettings":
                    vscode.commands.executeCommand("workbench.action.openSettings", "openclaude");
                    break;
                case "getConfig":
                    this._sendConfig();
                    break;
                case "saveSettings":
                    await this._saveSettings(msg.settings);
                    break;
                case "checkUpdate":
                    Promise.resolve().then(() => __importStar(require("./updater"))).then(({ checkForUpdates }) => {
                        checkForUpdates(this._context, true);
                    });
                    break;
                case "addContext":
                    this._addEditorContext();
                    break;
            }
        });
        // Send initial config
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible)
                this._sendConfig();
        });
        setTimeout(() => this._sendConfig(), 300);
    }
    _sendConfig() {
        const config = vscode.workspace.getConfiguration("openclaude");
        this._postMessage({
            type: "config",
            apiKey: config.get("apiKey", ""),
            baseUrl: config.get("baseUrl", "https://open-claude.com/v1"),
            model: config.get("model", "claude-opus-4.6"),
            maxTokens: config.get("maxTokens", 8192),
            temperature: config.get("temperature", 0.7),
            systemPrompt: config.get("systemPrompt", "You are Open Claude..."),
            models: models_1.MODELS,
        });
    }
    addContextFromEditor() {
        this._addEditorContext();
    }
    _addEditorContext() {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            // Fallback to visible editors if webview has focus (support Remote SSH/VFS)
            const visibleEditors = vscode.window.visibleTextEditors.filter((e) => e.document.uri.scheme !== "output");
            if (visibleEditors.length > 0) {
                editor = visibleEditors[0];
            }
        }
        if (!editor) {
            vscode.window.showWarningMessage("No active editor found.");
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection.isEmpty ? undefined : selection);
        const lang = editor.document.languageId;
        const fileName = path.basename(editor.document.fileName);
        const contextText = `\`\`\`${lang}\n// File: ${fileName}\n${text}\n\`\`\``;
        this._postMessage({ type: "addContext", text: contextText });
        if (this._view && !this._view.visible) {
            this._view.show(true);
        }
    }
    async _saveSettings(settings) {
        const config = vscode.workspace.getConfiguration("openclaude");
        await config.update("apiKey", settings.apiKey, vscode.ConfigurationTarget.Global);
        await config.update("baseUrl", settings.baseUrl, vscode.ConfigurationTarget.Global);
        await config.update("maxTokens", Number(settings.maxTokens), vscode.ConfigurationTarget.Global);
        await config.update("temperature", Number(settings.temperature), vscode.ConfigurationTarget.Global);
        await config.update("systemPrompt", settings.systemPrompt, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Cấu hình Open Claude đã được lưu!");
        this._sendConfig();
    }
    async _handleSendMessage(userText, model) {
        const config = vscode.workspace.getConfiguration("openclaude");
        const apiKey = config.get("apiKey", "");
        const baseUrl = config.get("baseUrl", "https://open-claude.com/v1");
        const maxTokens = config.get("maxTokens", 8192);
        const temperature = config.get("temperature", 0.7);
        const systemPrompt = config.get("systemPrompt", "");
        if (!apiKey) {
            this._postMessage({
                type: "error",
                message: '⚠️ Chưa cấu hình API Key. Vào Settings (Ctrl+,) → tìm "Open Claude" để nhập key.',
            });
            return;
        }
        // Build messages array
        if (this._messages.length === 0 && systemPrompt) {
            this._messages.push({ role: "system", content: systemPrompt });
        }
        this._messages.push({ role: "user", content: userText });
        this._postMessage({ type: "startAssistant" });
        const client = new apiClient_1.ApiClient(apiKey, baseUrl);
        let fullResponse = "";
        try {
            const stream = client.streamChat(this._messages, model, maxTokens, temperature, (abort) => {
                this._abortFn = abort;
            });
            for await (const chunk of stream) {
                if (chunk.done)
                    break;
                fullResponse += chunk.delta;
                this._postMessage({ type: "chunk", delta: chunk.delta });
            }
            this._messages.push({ role: "assistant", content: fullResponse });
            this._postMessage({ type: "doneAssistant" });
        }
        catch (err) {
            const error = err;
            this._postMessage({
                type: "error",
                message: `❌ Lỗi API: ${error.message}`,
            });
        }
        finally {
            this._abortFn = undefined;
        }
    }
    _insertCodeToEditor(code) {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            const visibleEditors = vscode.window.visibleTextEditors.filter((e) => e.document.uri.scheme !== "output");
            if (visibleEditors.length > 0) {
                editor = visibleEditors[0];
            }
        }
        if (!editor) {
            vscode.window.showWarningMessage("Không có editor đang mở.");
            return;
        }
        editor.edit((editBuilder) => {
            editBuilder.replace(editor.selection, code);
        });
        vscode.window.showInformationMessage("Code đã được chèn vào editor!");
    }
    _postMessage(msg) {
        this._view?.webview.postMessage(msg);
    }
    _getHtmlContent(webview) {
        const mediaPath = vscode.Uri.joinPath(this._context.extensionUri, "media");
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, "style.css"));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, "main.js"));
        const nonce = getNonce();
        return /* html */ `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; connect-src https://open-claude.com;">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" nonce="${nonce}">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Open Claude</title>
</head>
<body>
  <div id="app">
    <!-- Header -->
    <header id="header">
      <div class="header-left">
        <div class="logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#grad1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#a78bfa"/>
                <stop offset="100%" style="stop-color:#60a5fa"/>
              </linearGradient>
            </defs>
          </svg>
          <span class="logo-text">Open Claude</span>
        </div>
      </div>
      <div class="header-right">
        <select id="modelSelect" class="model-select" title="Chọn model AI">
          <option value="claude-opus-4.6">Claude Opus 4.6</option>
        </select>
        <button id="btnSettings" class="icon-btn" title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button id="btnClear" class="icon-btn" title="New Conversation">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- API Key Warning -->
    <div id="apiKeyWarning" class="api-warning hidden">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span>Chưa có API Key. <a href="#" id="linkSettings">Cấu hình ngay →</a></span>
    </div>

    <!-- Settings Panel -->
    <div id="settingsPanel" class="settings-panel hidden">
      <h2>Cấu hình Open Claude</h2>
      <div class="setting-item">
        <label>API Key</label>
        <input type="password" id="setApiKey" placeholder="Nhập API Key (bắt buộc)..." />
      </div>
      <div class="setting-item">
        <label>Base URL</label>
        <input type="text" id="setBaseUrl" placeholder="https://open-claude.com/v1" />
      </div>
      <div class="setting-item row">
        <div class="setting-item-half">
          <label>Max Tokens</label>
          <input type="number" id="setMaxTokens" value="8192" />
        </div>
        <div class="setting-item-half">
          <label>Temperature</label>
          <input type="number" id="setTemp" value="0.7" step="0.1" max="2" />
        </div>
      </div>
      <div class="setting-item">
        <label>System Prompt</label>
        <textarea id="setSystemPrompt" rows="4"></textarea>
      </div>
      <div class="settings-actions">
        <button id="btnSaveSettings" class="btn-primary">Lưu cấu hình</button>
        <button id="btnCloseSettings" class="btn-secondary">Đóng</button>
      </div>
      <div class="settings-actions" style="margin-top: 4px;">
        <button id="btnCheckUpdate" class="btn-secondary" style="width: 100%;">Kiểm tra bản cập nhật mới nhất</button>
      </div>
    </div>

    <!-- Messages -->
    <div id="chatContainer" class="chat-container">
      <div id="messageList" class="message-list">
        <div class="welcome-card">
          <div class="welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#wgrad)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <defs><linearGradient id="wgrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#60a5fa"/></linearGradient></defs>
            </svg>
          </div>
          <h2>Open Claude</h2>
          <p>AI coding assistant với 23+ frontier models.<br/>Chào mừng bạn đến với tương lai của lập trình!</p>
          <div class="quick-actions">
            <button class="quick-btn" data-text="Giải thích đoạn code này cho tôi">📖 Giải thích code</button>
            <button class="quick-btn" data-text="Tìm và sửa bug trong code sau:">🐛 Debug code</button>
            <button class="quick-btn" data-text="Viết unit tests cho hàm sau:">🧪 Viết tests</button>
            <button class="quick-btn" data-text="Refactor code này để tối ưu hơn:">⚡ Refactor</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div id="inputArea" class="input-area">
      <div class="input-toolbar">
        <button id="btnAddContext" class="tool-btn" title="Add editor selection to chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Add Code
        </button>
        <span id="tokenCountDisplay" class="token-hint"></span>
      </div>
      <div class="input-wrapper">
        <textarea
          id="userInput"
          class="user-input"
          placeholder="Hỏi Open Claude bất cứ điều gì... (Enter gửi, Shift+Enter xuống dòng)"
          rows="1"
        ></textarea>
        <button id="btnSend" class="send-btn" title="Send (Enter)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
        <button id="btnStop" class="stop-btn hidden" title="Stop generation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.OpenClaudeViewProvider = OpenClaudeViewProvider;
OpenClaudeViewProvider.viewType = "openclaude.chatView";
function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=chatProvider.js.map