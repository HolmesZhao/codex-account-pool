import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export class CodexRuntime {
  constructor({ command = "codex", timeoutMs = 30_000 } = {}) {
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.loginHandles = new Set();
  }

  async beginLogin() {
    const home = await mkdtemp(join(tmpdir(), "codex-pool-login-"));
    await chmod(home, 0o700);
    const client = await JsonLineClient.start(this.command, ["app-server"], { CODEX_HOME: home }, this.timeoutMs);
    try {
      await client.initialize();
      const result = await client.request("account/login/start", { type: "chatgptDeviceCode" });
      let handle;
      handle = new DeviceLoginHandle({ home, client, result, onClose: () => this.loginHandles.delete(handle) });
      this.loginHandles.add(handle);
      return handle;
    } catch (error) {
      await client.close();
      await rm(home, { recursive: true, force: true });
      throw error;
    }
  }

  async readQuota(authJson) {
    return withIsolatedCodexHome(authJson, async ({ home }) => {
      const client = await JsonLineClient.start(this.command, ["app-server"], { CODEX_HOME: home }, this.timeoutMs);
      try {
        await client.initialize();
        const account = await client.request("account/read", {}).catch(() => null);
        const response = await client.request("account/rateLimits/read", {});
        const value = response?.rateLimits || response || {};
        return {
          primary: value.primary || null,
          secondary: value.secondary || null,
          credits: value.credits ?? null,
          planType: value.planType || account?.account?.planType || null,
          ordinaryUsageAllowed: response?.ordinaryUsageAllowed ?? null,
        };
      } finally { await client.close(); }
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
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"], shell: false });
    const client = new JsonLineClient(child, timeoutMs);
    await client.started;
    return client;
  }
  constructor(child, timeoutMs) {
    this.child = child; this.timeoutMs = timeoutMs; this.nextId = 1; this.pending = new Map(); this.stderr = "";
    this.started = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-4096); });
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.on("exit", (code) => this.rejectAll(new Error(`codex app-server exited (${code ?? "signal"}): ${safeDiagnostic(this.stderr)}`)));
  }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "codex-account-pool", title: "Codex Account Pool", version: "0.1.0" }, capabilities: {} });
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
    if (message.error) pending.reject(Object.assign(new Error(String(message.error.message || "codex app-server request failed")), { code: message.error.code || "CODEX_APP_SERVER_ERROR" }));
    else pending.resolve(message.result);
  }
  rejectAll(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  async close() {
    if (this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => this.child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1_000))]);
    }
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
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
  return String(value || "").replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]").replace(/((?:access|refresh|id)[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 240);
}
