/* ============================================================
   Open Claude — Webview Main Script
   Handles: UI interactions, message passing with extension host,
   streaming rendering, markdown/code highlighting
   ============================================================ */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // --- State ---
  let isGenerating = false;
  let currentModel = "claude-opus-4.6";
  let currentAssistantEl = null;
  let previousState = vscode.getState() || { messages: [] };
  let attachedContexts = [];

  // --- DOM Refs ---
  const messageList   = document.getElementById("messageList");
  const userInput     = document.getElementById("userInput");
  const btnSend       = document.getElementById("btnSend");
  const btnStop       = document.getElementById("btnStop");
  const btnClear      = document.getElementById("btnClear");
  const btnSettings   = document.getElementById("btnSettings");
  const btnAddContext = document.getElementById("btnAddContext");
  const btnAttach     = document.getElementById("btnAttach");
  const modelSelect   = document.getElementById("modelSelect");
  const apiKeyWarning = document.getElementById("apiKeyWarning");
  const linkSettings  = document.getElementById("linkSettings");
  const tokenDisplay  = document.getElementById("tokenCountDisplay");
  
  // Settings Panel
  const chatContainer = document.getElementById("chatContainer");
  const inputArea     = document.getElementById("inputArea");
  const settingsPanel = document.getElementById("settingsPanel");
  const setApiKey     = document.getElementById("setApiKey");
  const setBaseUrl    = document.getElementById("setBaseUrl");
  const setMaxTokens    = document.getElementById("setMaxTokens");
  const setTemp         = document.getElementById("setTemp");
  const setSystemPrompt = document.getElementById("setSystemPrompt");
  const setGithubToken  = document.getElementById("setGithubToken");
  const btnSaveSettings = document.getElementById("btnSaveSettings");
  const btnCloseSettings= document.getElementById("btnCloseSettings");
  const btnCheckUpdate   = document.getElementById("btnCheckUpdate");

  // --- Init ---
  vscode.postMessage({ type: "getConfig" });

  // Restore scroll position
  restoreState();

  // --- Event Listeners ---
  userInput.addEventListener("input",    autoResize);
  userInput.addEventListener("keydown",  handleKeyDown);
  userInput.addEventListener("paste",    handlePaste);
  btnSend.addEventListener("click",      sendMessage);
  btnStop.addEventListener("click",      stopGeneration);
  btnClear.addEventListener("click",     clearChat);
  btnSettings.addEventListener("click",  openSettings);
  if (btnAddContext) btnAddContext.addEventListener("click", addContext);
  if (btnAttach) {
    btnAttach.addEventListener("click", () => {
      vscode.postMessage({ type: "pickFiles" });
    });
  }
  linkSettings.addEventListener("click", openSettings);
  modelSelect.addEventListener("change", () => {
    currentModel = modelSelect.value;
  });
  
  btnSaveSettings.addEventListener("click", () => {
    vscode.postMessage({
      type: "saveSettings",
      settings: {
        apiKey: setApiKey.value.trim(),
        baseUrl: setBaseUrl.value.trim(),
        maxTokens: parseInt(setMaxTokens.value) || 8192,
        temperature: parseFloat(setTemp.value) || 0.7,
        systemPrompt: setSystemPrompt.value,
        githubToken: setGithubToken ? setGithubToken.value.trim() : ""
      }
    });
    closeSettings();
  });
  btnCloseSettings.addEventListener("click", closeSettings);
  
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener("click", () => {
      vscode.postMessage({ type: "checkUpdate" });
    });
  }

  // Quick action buttons
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-text");
      if (text) {
        userInput.value = text;
        userInput.focus();
        autoResize();
      }
    });
  });

  // --- Message Handler from Extension Host ---
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "config":
        applyConfig(msg);
        break;
      case "startAssistant":
        startAssistantMessage();
        break;
      case "chunk":
        appendChunk(msg.delta);
        break;
      case "doneAssistant":
        finishAssistantMessage();
        break;
      case "error":
        showError(msg.message);
        break;
      case "cleared":
        clearMessages();
        break;
      case "addContext":
        addContextMessage(msg.fileName, msg.text);
        break;
    }
  });

  // ============================================================
  //  Config
  // ============================================================
  function applyConfig(cfg) {
    currentModel = cfg.model || "claude-opus-4.6";

    // Rebuild model select
    modelSelect.innerHTML = "";
    const modelList = cfg.models || [{ id: cfg.model, label: cfg.model, provider: "" }];
    modelList.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      opt.title = m.provider || "";
      if (m.id === currentModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });

    // Populate settings panel
    if (cfg.apiKey !== undefined) setApiKey.value = cfg.apiKey;
    if (cfg.baseUrl !== undefined) setBaseUrl.value = cfg.baseUrl;
    if (cfg.maxTokens !== undefined) setMaxTokens.value = cfg.maxTokens;
    if (cfg.temperature !== undefined) setTemp.value = cfg.temperature;
    if (cfg.systemPrompt !== undefined) setSystemPrompt.value = cfg.systemPrompt;
    if (cfg.githubToken !== undefined && setGithubToken) setGithubToken.value = cfg.githubToken;

    // API key warning
    if (!cfg.apiKey) {
      apiKeyWarning.classList.remove("hidden");
    } else {
      apiKeyWarning.classList.add("hidden");
    }
  }

  // ============================================================
  //  Sending
  // ============================================================
  function sendMessage() {
    if (isGenerating) return;
    const text = userInput.value.trim();
    if (!text && attachedContexts.length === 0) return;

    let finalPrompt = "";
    const textContexts = attachedContexts.filter(c => !c.isImage);
    const imageContexts = attachedContexts.filter(c => c.isImage).map(c => ({ url: c.url }));

    if (textContexts.length > 0) {
      textContexts.forEach(ctx => {
        finalPrompt += ctx.text + "\n\n";
      });
    }
    finalPrompt += text;

    // Remove welcome card
    const welcomeCard = document.querySelector(".welcome-card");
    if (welcomeCard) welcomeCard.remove();

    appendUserMessage(text, attachedContexts);
    attachedContexts = [];
    renderPills();

    userInput.value = "";
    autoResize();

    vscode.postMessage({ type: "sendMessage", text: finalPrompt, images: imageContexts, model: currentModel });
  }

  function stopGeneration() {
    vscode.postMessage({ type: "stopGeneration" });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ============================================================
  //  Message rendering
  // ============================================================
  function appendUserMessage(text, contexts = []) {
    const div = document.createElement("div");
    div.className = "message user-message";
    
    let pillsHtml = "";
    if (contexts && contexts.length > 0) {
      pillsHtml = `<div class="context-pills" style="margin-bottom: 8px;">` + 
        contexts.map(c => {
          const icon = c.isImage ? "🖼️" : "📎";
          return `<div class="pill">${icon} ${escapeHtml(c.fileName)}</div>`;
        }).join("") + 
        `</div>`;
    }

    div.innerHTML = `
      <div class="message-avatar user-avatar">U</div>
      <div class="message-content">
        ${pillsHtml}
        ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ''}
      </div>`;
    messageList.appendChild(div);
    scrollToBottom();
  }

  function startAssistantMessage() {
    isGenerating = true;
    setGeneratingState(true);

    const div = document.createElement("div");
    div.className = "message assistant-message generating";
    div.innerHTML = `
      <div class="message-avatar assistant-avatar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#ag)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <defs><linearGradient id="ag" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#60a5fa"/></linearGradient></defs>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-model-tag">${currentModel}</div>
        <div class="message-text thinking-dots"><span></span><span></span><span></span></div>
      </div>`;
    messageList.appendChild(div);
    currentAssistantEl = div.querySelector(".message-text");
    scrollToBottom();
  }

  let rawBuffer = "";

  function appendChunk(delta) {
    if (!currentAssistantEl) return;
    if (currentAssistantEl.classList.contains("thinking-dots")) {
      currentAssistantEl.classList.remove("thinking-dots");
      currentAssistantEl.innerHTML = "";
      rawBuffer = "";
    }
    rawBuffer += delta;
    currentAssistantEl.innerHTML = renderMarkdown(rawBuffer);
    attachCodeButtons(currentAssistantEl);
    scrollToBottom();
  }

  function finishAssistantMessage() {
    isGenerating = false;
    setGeneratingState(false);
    if (currentAssistantEl) {
      const parent = currentAssistantEl.closest(".assistant-message");
      if (parent) parent.classList.remove("generating");
      currentAssistantEl = null;
      rawBuffer = "";
    }
  }

  function showError(message) {
    isGenerating = false;
    setGeneratingState(false);
    if (currentAssistantEl) {
      currentAssistantEl.innerHTML = `<div class="error-msg">${message}</div>`;
      currentAssistantEl = null;
      rawBuffer = "";
    } else {
      const div = document.createElement("div");
      div.className = "message assistant-message";
      div.innerHTML = `<div class="message-content"><div class="error-msg">${message}</div></div>`;
      messageList.appendChild(div);
    }
    scrollToBottom();
  }

  function clearMessages() {
    rawBuffer = "";
    currentAssistantEl = null;
    isGenerating = false;
    setGeneratingState(false);
    messageList.innerHTML = `
      <div class="welcome-card">
        <div class="welcome-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#wg2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <defs><linearGradient id="wg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#60a5fa"/></linearGradient></defs>
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
      </div>`;
    // Reattach quick btn listeners
    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        userInput.value = btn.getAttribute("data-text") || "";
        userInput.focus();
        autoResize();
      });
    });
  }

  // ============================================================
  //  Markdown Renderer (no external deps)
  // ============================================================
  function renderMarkdown(text) {
    let html = text;

    // Fenced code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const langLabel = lang || "code";
      const escaped = escapeHtml(code.trim());
      return `<div class="code-block">
        <div class="code-header">
          <span class="code-lang">${escapeHtml(langLabel)}</span>
          <div class="code-actions">
            <button class="code-btn copy-btn" data-code="${encodeURIComponent(code.trim())}">Copy</button>
            <button class="code-btn insert-btn" data-code="${encodeURIComponent(code.trim())}">Insert</button>
          </div>
        </div>
        <pre><code class="lang-${escapeHtml(langLabel)}">${escaped}</code></pre>
      </div>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code class=\"inline-code\">$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Headers
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Bullet lists
    html = html.replace(/^[\*\-] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Horizontal rule
    html = html.replace(/^---$/gm, "<hr/>");

    // Paragraphs (double newlines)
    html = html.replace(/\n\n/g, "</p><p>");

    // Single newlines
    html = html.replace(/\n/g, "<br/>");

    return `<p>${html}</p>`;
  }

  function attachCodeButtons(container) {
    container.querySelectorAll(".copy-btn").forEach((btn) => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => {
        const code = decodeURIComponent(newBtn.getAttribute("data-code"));
        vscode.postMessage({ type: "copyCode", code });
        newBtn.textContent = "Copied!";
        setTimeout(() => (newBtn.textContent = "Copy"), 1500);
      });
    });
    container.querySelectorAll(".insert-btn").forEach((btn) => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => {
        const code = decodeURIComponent(newBtn.getAttribute("data-code"));
        vscode.postMessage({ type: "insertCode", code });
      });
    });
  }

  // ============================================================
  //  Helpers
  // ============================================================
  function clearChat() {
    vscode.postMessage({ type: "clearChat" });
  }

  function openSettings(e) {
    if (e) e.preventDefault();
    chatContainer.classList.add("hidden");
    inputArea.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
  }

  function closeSettings() {
    settingsPanel.classList.add("hidden");
    chatContainer.classList.remove("hidden");
    inputArea.classList.remove("hidden");
    scrollToBottom();
  }

  function addContext() {
    vscode.postMessage({ type: "addContext" });
  }

  function addContextMessage(fileName, text) {
    attachedContexts.push({ fileName, text, isImage: false });
    renderPills();
    userInput.focus();
  }

  function handlePaste(e) {
    if (!e.clipboardData) return;
    const items = e.clipboardData.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") === 0) {
        hasImage = true;
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Data = event.target.result;
          const fileName = "Image_" + (attachedContexts.filter(c => c.isImage).length + 1) + ".png";
          attachedContexts.push({ isImage: true, url: base64Data, fileName });
          renderPills();
        };
        reader.readAsDataURL(blob);
      }
    }
    if (hasImage) {
      e.preventDefault();
    }
  }

  function renderPills() {
    const container = document.getElementById("contextPills");
    if (!container) return;
    container.innerHTML = "";
    attachedContexts.forEach((ctx, idx) => {
      const div = document.createElement("div");
      div.className = "pill";
      const icon = ctx.isImage ? "🖼️" : "📎";
      div.innerHTML = `
        <span>${icon} ${escapeHtml(ctx.fileName)}</span>
        <span class="remove-pill" data-idx="${idx}">✕</span>
      `;
      container.appendChild(div);
    });
    
    container.querySelectorAll(".remove-pill").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"));
        attachedContexts.splice(idx, 1);
        renderPills();
      });
    });
  }

  function setGeneratingState(generating) {
    btnSend.classList.toggle("hidden", generating);
    btnStop.classList.toggle("hidden", !generating);
    userInput.disabled = generating;
  }

  function autoResize() {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
  }

  function scrollToBottom() {
    const container = document.getElementById("chatContainer");
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function restoreState() {
    // Nothing to restore for now — messages are held in extension host
  }
})();
