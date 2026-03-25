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
exports.checkForUpdates = checkForUpdates;
const vscode = __importStar(require("vscode"));
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const GITHUB_API_URL = "https://api.github.com/repos/mtzvb/Open-Claude.com/contents";
const MAX_REDIRECTS = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max for VSIX
async function checkForUpdates(context, manualCheck = false) {
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
            const action = await vscode.window.showInformationMessage(`🚀 Open Claude v${remoteVersion} đã sẵn sàng! (Hiện tại: v${currentVersion})`, "Cập nhật ngay", "Để sau");
            if (action === "Cập nhật ngay") {
                await downloadAndInstallUpdate(remoteVersion);
            }
        }
        else {
            if (manualCheck) {
                vscode.window.showInformationMessage(`✅ Phiên bản v${currentVersion} hiện tại đã là bản mới nhất!`);
            }
        }
    }
    catch (err) {
        if (manualCheck) {
            if (err.message && err.message.includes("404")) {
                vscode.window.showErrorMessage("❌ Lỗi 404: Không tìm thấy Repo. Nếu đây là Private Repo, vui lòng nhập GitHub Token trong Cài đặt (⚙️).");
            }
            else {
                vscode.window.showErrorMessage(`❌ Lỗi kiểm tra cập nhật: ${err.message}`);
            }
        }
        console.error("Open Claude update check failed:", err);
    }
}
async function downloadAndInstallUpdate(version) {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Đang tải Open Claude v${version}...`,
        cancellable: false,
    }, async (progress) => {
        const vsixName = `open-claude-${version}.vsix`;
        const tmpVsixPath = path.join(os.tmpdir(), vsixName);
        try {
            await downloadGitHubFile(vsixName, tmpVsixPath);
            // Basic Integrity Check: Verify ZIP magic bytes (PK\x03\x04)
            if (!verifyZipIntegrity(tmpVsixPath)) {
                throw new Error("File tải về bị lỗi hoặc không phải định dạng VSIX an toàn.");
            }
            progress.report({ message: "Đang cài đặt extension..." });
            await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(tmpVsixPath));
            const reload = await vscode.window.showInformationMessage("✅ Cập nhật thành công! Vui lòng tải lại VS Code để áp dụng thay đổi.", "Tải lại (Reload Window)");
            if (reload === "Tải lại (Reload Window)") {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`❌ Lỗi cập nhật: ${err.message}`);
        }
        finally {
            // VULNERABILITY FIXED: Always cleanup temporary files
            if (fs.existsSync(tmpVsixPath)) {
                try {
                    fs.unlinkSync(tmpVsixPath);
                }
                catch (e) {
                    console.error("Failed to cleanup VSIX:", e);
                }
            }
        }
    });
}
// VULNERABILITY FIXED: Safer Semver comparison ignoring pre-releases unless strictly required
function isNewerVersion(current, remote) {
    if (remote.includes("-") || current.includes("-")) {
        return false; // Skip pre-releases for automated updates
    }
    const parse = (v) => v.split(".").map(Number);
    const curTokens = parse(current);
    const remTokens = parse(remote);
    for (let i = 0; i < Math.max(curTokens.length, remTokens.length); i++) {
        const c = curTokens[i] || 0;
        const r = remTokens[i] || 0;
        if (r > c)
            return true;
        if (r < c)
            return false;
    }
    return false;
}
function getGitHubToken() {
    const config = vscode.workspace.getConfiguration("openclaude");
    return config.get("githubToken", "").trim();
}
function httpsGet(url, options, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        // VULNERABILITY FIXED: Limit redirects
        if (redirectCount > MAX_REDIRECTS)
            return reject(new Error("Quá nhiều lượt chuyển hướng (Redirect loop)"));
        https.get(url, options, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // VULNERABILITY FIXED: Restrict redirect domain
                const location = res.headers.location;
                if (!location.startsWith("https://github.com/") && !location.startsWith("https://api.github.com/") && !location.startsWith("https://raw.githubusercontent.com/") && !location.startsWith("https://objects.githubusercontent.com/")) {
                    return reject(new Error(`Bị chặn chuyển hướng đến domain không an toàn: ${location}`));
                }
                return httpsGet(location, options, redirectCount + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Status ${res.statusCode}`));
            }
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    resolve(data);
                }
            });
        }).on("error", reject);
    });
}
async function fetchGitHubFile(filepath) {
    const token = getGitHubToken();
    const url = `${GITHUB_API_URL}/${filepath}`;
    const options = {
        headers: {
            "Accept": "application/vnd.github.v3.raw",
            "User-Agent": "Open-Claude-Updater",
            ...(token ? { "Authorization": `token ${token}` } : {})
        }
    };
    return httpsGet(url, options);
}
function downloadGitHubFile(filepath, dest, redirectUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > MAX_REDIRECTS)
            return reject(new Error("Quá nhiều lượt chuyển hướng khi tải file"));
        const defaultUrl = `${GITHUB_API_URL}/${filepath}`;
        let targetUrl = redirectUrl || defaultUrl;
        const token = getGitHubToken();
        const options = redirectUrl ? { headers: { "User-Agent": "Open-Claude-Updater" } } : {
            headers: {
                "Accept": "application/vnd.github.v3.raw",
                "User-Agent": "Open-Claude-Updater",
                ...(token ? { "Authorization": `token ${token}` } : {})
            }
        };
        https.get(targetUrl, options, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const location = res.headers.location;
                if (!location.startsWith("https://github.com/") && !location.startsWith("https://api.github.com/") && !location.startsWith("https://raw.githubusercontent.com/") && !location.startsWith("https://objects.githubusercontent.com/")) {
                    return reject(new Error(`Bị chặn chuyển hướng tải file đến domain không an toàn: ${location}`));
                }
                return downloadGitHubFile(filepath, dest, location, redirectCount + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Status ${res.statusCode} downloading VSIX`));
            }
            let downloadedBytes = 0;
            const file = fs.createWriteStream(dest);
            res.on("data", (chunk) => {
                downloadedBytes += chunk.length;
                if (downloadedBytes > MAX_FILE_SIZE) {
                    res.destroy();
                    file.close();
                    fs.unlink(dest, () => reject(new Error("File tải về vượt quá dung lượng cho phép (50MB)")));
                }
            });
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
function verifyZipIntegrity(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(4);
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        // ZIP magic bytes: PK\x03\x04
        return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    }
    catch (err) {
        return false;
    }
}
//# sourceMappingURL=updater.js.map