const https = require("https");
const GITHUB_TOKEN = "ghp_" + "8ow3rB69VXAYj9FEXkYdiVfcLWuu7f3EKTJq";

function httpsGet(url, options) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    }).on("error", reject);
  });
}

const url = "https://api.github.com/repos/mtzvb/Open-Claude.com/contents/package.json";
const options = {
  headers: {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3.raw",
    "User-Agent": "Open-Claude-Updater"
  }
};

httpsGet(url, options)
  .then(res => console.log("SUCCESS:", typeof res === 'object' ? res.version : res))
  .catch(err => console.error("ERROR:", err));
