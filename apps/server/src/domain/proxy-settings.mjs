import { codexError } from "../common/contracts.mjs";

const CONTEXT = { accountId: "system:http-proxy", generation: 1 };
const PROXY_ENV = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];

export class ProxySettings {
  constructor({ repository, vault }) { this.repository = repository; this.vault = vault; }
  read() {
    const sealed = this.repository.getSetting("http-proxy");
    return sealed ? this.vault.decrypt(sealed, CONTEXT) : { enabled: false, url: "" };
  }
  publicState() {
    const { enabled, url } = this.read();
    const address = url ? new URL(url) : null;
    if (address) { address.username = ""; address.password = ""; }
    return { enabled, configured: Boolean(url), address: address ? `${address.protocol}//${address.host}` : "" };
  }
  save(input) {
    if (!input || typeof input.enabled !== "boolean") throw invalid();
    const current = this.read();
    const url = input.url === undefined ? current.url : validateUrl(input.url);
    if (input.enabled && !url) throw invalid();
    this.repository.saveSetting("http-proxy", this.vault.encrypt({ enabled: input.enabled, url }, CONTEXT));
    return this.publicState();
  }
  environment() {
    const { enabled, url } = this.read();
    const env = Object.fromEntries(PROXY_ENV.map((key) => [key, ""]));
    if (enabled) for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) env[key] = url.startsWith("socks5:") ? url.replace(/^socks5:/, "socks5h:") : url;
    return env;
  }
}
function invalid() { return codexError("CODEX_PROXY_INVALID", "请输入有效的 HTTP 或 SOCKS5 代理地址，例如 http://192.168.1.10:7890 或 socks5://192.168.1.10:1080（不支持路径、查询参数或片段）", 400); }
function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw invalid();
  if (!value.trim()) return "";
  let url;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (!["http:", "socks5:", "socks5h:"].includes(url.protocol) || !url.hostname || !["", "/"].includes(url.pathname) || url.search || url.hash) throw invalid();
  if (url.protocol.startsWith("socks5")) {
    try {
      if (Buffer.byteLength(decodeURIComponent(url.username)) > 255 || Buffer.byteLength(decodeURIComponent(url.password)) > 255) throw invalid();
    } catch { throw invalid(); }
  }
  return url.href;
}
