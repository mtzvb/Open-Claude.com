import * as vscode from "vscode";
import { OpenClaudeViewProvider } from "./chatProvider";
import { checkForUpdates } from "./updater";

export function activate(context: vscode.ExtensionContext) {
  // Check for updates from GitHub in the background
  checkForUpdates(context);

  const provider = new OpenClaudeViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OpenClaudeViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Command: Open Chat sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("openclaude.openChat", () => {
      vscode.commands.executeCommand("openclaude.chatView.focus");
    })
  );

  // Command: New conversation
  context.subscriptions.push(
    vscode.commands.registerCommand("openclaude.newConversation", () => {
      provider["_messages"] = [];
      provider["_postMessage"]({ type: "cleared" });
      vscode.commands.executeCommand("openclaude.chatView.focus");
    })
  );

  // Command: Add editor context
  context.subscriptions.push(
    vscode.commands.registerCommand("openclaude.addContext", () => {
      provider.addContextFromEditor();
      vscode.commands.executeCommand("openclaude.chatView.focus");
    })
  );

  // Watch config changes → refresh webview
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("openclaude")) {
        provider["_sendConfig"]();
      }
    })
  );
}

export function deactivate() {}
