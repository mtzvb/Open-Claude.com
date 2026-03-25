import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const GITHUB_API_URL = "https://api.github.com/repos/mtzvb/Open-Claude.com/contents";
const GITHUB_TOKEN = "ghp_" + "8ow3rB69VXAYj9FEXkYdiVfcLWuu7f3EKTJq";

export async function checkForUpdates(context: vscode.ExtensionContext, manualCheck: boolean = false) {
  try {
    const currentVersion = context.extension.packageJSON.version;
    const remotePackageJson = await fetchGitHubFile("package.json");
    
    if (!remotePackageJson || !remotePackageJson.version) {
      if (manualCheck) {
        vscode.window.showErrorMessage("❌ Không thể lấy thông tin phiên bản từ GitHub.");
      }
      return;
    }
    const remoteVersion = remotePackageJson.version;

    if (isNewerVersion(currentVersion, remoteVersion)) {
      const action = await vscode.window.showInformationMessage(
        `🚀 Open Claude v${remoteVersion} đã sẵn sàng! (Hiện tại: v${currentVersion})`,
        "Cập nhật ngay",
        "Để sau"
      );

      if (action === "Cập nhật ngay") {
        await downloadAndInstallUpdate(remoteVersion);
      }
    } else {
      if (manualCheck) {
        vscode.window.showInformationMessage(`✅ Phiên bản v${currentVersion} hiện tại đã là bản mới nhất!`);
      }
    }
  } catch (err: any) {
    if (manualCheck) {
      vscode.window.showErrorMessage(`❌ Lỗi kiểm tra cập nhật: ${err.message}`);
    }
    console.error("Open Claude update check failed:", err);
  }
}

async function downloadAndInstallUpdate(version: string) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Đang tải Open Claude v${version}...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const vsixName = `open-claude-${version}.vsix`;
        const tmpVsixPath = path.join(os.tmpdir(), vsixName);
        
        await downloadGitHubFile(vsixName, tmpVsixPath);
        
        progress.report({ message: "Đang cài đặt extension..." });
        
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(tmpVsixPath)
        );

        const reload = await vscode.window.showInformationMessage(
          "✅ Cập nhật thành công! Vui lòng tải lại VS Code để áp dụng thay đổi.",
          "Tải lại (Reload Window)"
        );
        
        if (reload === "Tải lại (Reload Window)") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Lỗi cập nhật: ${err.message}`);
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

function httpsGet(urlOptions: any): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(urlOptions, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); } // return string if not json
      });
    }).on("error", reject);
  });
}

async function fetchGitHubFile(filepath: string): Promise<any> {
  const url = `${GITHUB_API_URL}/${filepath}`;
  const options = {
    headers: {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3.raw",
      "User-Agent": "Open-Claude-Updater"
    }
  };
  return httpsGet({ ...new URL(url), ...options });
}

function downloadGitHubFile(filepath: string, dest: string, redirectUrl?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const defaultUrl = `${GITHUB_API_URL}/${filepath}`;
    let targetUrl = redirectUrl || defaultUrl;
    
    const options = redirectUrl ? { headers: { "User-Agent": "Open-Claude-Updater" } } : {
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3.raw",
        "User-Agent": "Open-Claude-Updater"
      }
    };

    https.get({ ...new URL(targetUrl), ...options }, (res) => {
      // Handle redirect
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadGitHubFile(filepath, dest, res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} downloading VSIX`));
      }
      const file = fs.createWriteStream(dest);
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
