import { startSocksProxyBridge } from "./socks-proxy-bridge.mjs";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export class CodexRuntime {
  constructor({ command = "codex", timeoutMs = 30_000, getProxyEnvironment = () => ({}) } = {}) {
    this.command = command;
    this.getProxyEnvironment = getProxyEnvironment;
    this.timeoutMs = timeoutMs;
    this.loginHandles = new Set();
  }

  async beginLogin() {
    const proxyEnv = this.getProxyEnvironment();
    const home = await mkdtemp(join(tmpdir(), "codex-pool-login-"));
    await chmod(home, 0o700);
    let client;
    try {
      client = await JsonLineClient.start(this.command, ["app-server"], { ...proxyEnv, CODEX_HOME: home }, this.timeoutMs);
      await client.initialize();
      const result = await client.request("account/login/start", { type: "chatgptDeviceCode" });
      let handle;
      handle = new DeviceLoginHandle({ home, client, result, onClose: () => this.loginHandles.delete(handle) });
      this.loginHandles.add(handle);
      return handle;
    } catch (error) {
      await client?.close();
      await rm(home, { recursive: true, force: true });
      throw error;
    }
  }

  async readQuota(authJson) {
    const result = await this.inspect(authJson, { quotaOnly: true });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.quota;
  }

  async inspect(authJson, { refresh = false, quotaOnly = false } = {}) {
    return withIsolatedCodexHome(authJson, async ({ home }) => {
      const client = await JsonLineClient.start(this.command, ["app-server"], { ...this.getProxyEnvironment(), CODEX_HOME: home }, this.timeoutMs);
      let account, quota = null, error = null, refreshed = false;
      try {
        await client.initialize();
        if (!quotaOnly) {
          account = await client.request("account/read", {});
          if (refresh || /loggedout|unauth|expired/i.test(String(account?.account?.type || account?.account?.status || account?.status || ""))) {
            account = await client.request("account/read", { refreshToken: true });
            refreshed = true;
          }
          if ((account?.requiresOpenaiAuth && !account.account) || /loggedout|unauth|expired/i.test(String(account?.account?.type || account?.account?.status || account?.status || ""))) throw new Error("reauth required: account not authenticated");
        }
        const response = await client.request("account/rateLimits/read", {});
        const value = response?.rateLimits || response || {};
        quota = { primary: value.primary || null, secondary: value.secondary || null, credits: value.credits ?? null, planType: value.planType || account?.account?.planType || null, ordinaryUsageAllowed: response?.ordinaryUsageAllowed ?? null };
      } catch (reason) { error = { code: reason.code, message: safeDiagnostic(reason.message) }; }
      finally { await client.close(); }
      // Read back even after an upstream quota failure: an earlier RT rotation may have succeeded.
      const updatedAuthJson = await readFile(join(home, "auth.json"), "utf8");
      return { quota, updatedAuthJson, refreshed, error };
    });
  }

  async close() { await Promise.allSettled([...this.loginHandles].map((handle) => handle.close())); }
}

class DeviceLoginHandle {
  constructor({ home, client, result, onClose }) {
    this.home = home; this.client = client; this.result = result || {}; this.onClose = onClose; this.status = "pending"; this.closed = false;
  }
  publicState() {
    return { status: this.status, userCode: this.result.userCode || "", verificationUrl: this.result.verificationUrl || "", expiresAt: this.result.expiresAt || "" };
  }
  async poll() {
    if (this.status !== "pending") return this.publicState();
    try {
      const authJson = await readFile(join(this.home, "auth.json"), "utf8");
      JSON.parse(authJson);
      this.status = "complete";
      return { ...this.publicState(), authJson };
    } catch { return this.publicState(); }
  }
  async cancel() {
    const loginId = this.result.loginId;
    if (loginId && !this.closed) await this.client.request("account/login/cancel", { loginId }).catch(() => null);
    this.status = "cancelled";
    await this.close();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.client.close();
    await rm(this.home, { recursive: true, force: true });
    this.onClose?.();
  }
}

class JsonLineClient {
  static async start(command, args, extraEnv, timeoutMs) {
    let bridge;
    if (/^socks5h?:/.test(extraEnv.HTTPS_PROXY || "")) {
      bridge = await startSocksProxyBridge(extraEnv.HTTPS_PROXY);
      extraEnv = { ...extraEnv, HTTP_PROXY: bridge.url, HTTPS_PROXY: bridge.url, http_proxy: bridge.url, https_proxy: bridge.url, ALL_PROXY: "", all_proxy: "", NO_PROXY: "", no_proxy: "" };
    }
    try {
      const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"], shell: false });
      const client = new JsonLineClient(child, timeoutMs);
      client.bridge = bridge;
      await client.started;
      return client;
    } catch (error) { await bridge?.close(); throw error; }
  }
  constructor(child, timeoutMs) {
    this.child = child; this.timeoutMs = timeoutMs; this.nextId = 1; this.pending = new Map(); this.stderr = "";
    this.started = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-4096); });
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.on("exit", (code) => this.rejectAll(new Error(`codex app-server exited (${code ?? "signal"}): ${safeDiagnostic(this.stderr)}`)));
  }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "codex-account-pool", title: "Codex Account Pool", version: "1.0.2" }, capabilities: {} });
    this.notify("initialized", {});
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error(`codex app-server request timed out: ${method}${this.stderr ? ` (${safeDiagnostic(this.stderr)})` : ""}`), { code: "CODEX_APP_SERVER_TIMEOUT" })); }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  notify(method, params) { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) pending.reject(Object.assign(new Error(safeDiagnostic(message.error.message || "codex app-server request failed")), { code: message.error.code || "CODEX_APP_SERVER_ERROR" }));
    else pending.resolve(message.result);
  }
  rejectAll(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  async close() {
    if (this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => this.child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1_000))]);
    }
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
    await this.bridge?.close();
  }
}

async function withIsolatedCodexHome(authJson, callback) {
  const home = await mkdtemp(join(tmpdir(), "codex-pool-account-"));
  await chmod(home, 0o700);
  try {
    await writeFile(join(home, "auth.json"), typeof authJson === "string" ? authJson : JSON.stringify(authJson), { encoding: "utf8", mode: 0o600, flag: "wx" });
    return await callback({ home });
  } finally { await rm(home, { recursive: true, force: true }); }
}

function safeDiagnostic(value) {
  return String(value || "").replace(/((?:https?|socks5h?):\/\/)[^\s/]+@/gi, "$1[REDACTED]@").replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]").replace(/((?:access|refresh|id)[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 240);
}
