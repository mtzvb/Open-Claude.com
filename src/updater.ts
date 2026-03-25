import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const REPO_RAW_URL = "https://raw.githubusercontent.com/mtzvb/Open-Claude.com/main";

export async function checkForUpdates(context: vscode.ExtensionContext) {
  try {
    const currentVersion = context.extension.packageJSON.version;
    const remotePackageJson = await fetchJson(`${REPO_RAW_URL}/package.json`);
    
    if (!remotePackageJson || !remotePackageJson.version) return;
    const remoteVersion = remotePackageJson.version;

    if (isNewerVersion(currentVersion, remoteVersion)) {
      const action = await vscode.window.showInformationMessage(
        `🚀 Open Claude v${remoteVersion} is available! (Current: v${currentVersion})`,
        "Update Now",
        "Later"
      );

      if (action === "Update Now") {
        await downloadAndInstallUpdate(remoteVersion);
      }
    }
  } catch (err) {
    console.error("Open Claude update check failed:", err);
  }
}

async function downloadAndInstallUpdate(version: string) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Downloading Open Claude v${version}...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const vsixUrl = `${REPO_RAW_URL}/open-claude-${version}.vsix`;
        const tmpVsixPath = path.join(os.tmpdir(), `open-claude-${version}.vsix`);
        
        await downloadFile(vsixUrl, tmpVsixPath);
        
        progress.report({ message: "Installing extension..." });
        
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(tmpVsixPath)
        );

        const reload = await vscode.window.showInformationMessage(
          "✅ Update installed successfully! Please reload VS Code to apply changes.",
          "Reload Window"
        );
        
        if (reload === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Update failed: ${err.message}`);
      }
    }
  );
}

function isNewerVersion(current: string, remote: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const curTokens = parse(current);
  const remTokens = parse(remote);
  
  for (let i = 0; i < Math.max(curTokens.length, remTokens.length); i++) {
    const c = curTokens[i] || 0;
    const r = remTokens[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        fs.unlink(dest, () => reject(new Error(`Status ${res.statusCode} downloading VSIX`)));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}
