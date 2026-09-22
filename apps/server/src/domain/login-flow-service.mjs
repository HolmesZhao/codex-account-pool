import { randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export class LoginFlowService {
  constructor({ permissionService, runtime, accountService, now = () => new Date(), ttlMs = 10 * 60_000 }) {
    this.permissionService = permissionService; this.runtime = runtime; this.accountService = accountService; this.now = now; this.ttlMs = ttlMs; this.flows = new Map();
  }
  async start(subject, { mode = "import", accountId = null } = {}) {
    await this.permissionService.require(subject, mode === "reauth" ? "codex_account:reauth" : "codex_account:import");
    if (mode === "reauth") await this.accountService.get(subject, accountId, "codex_account:reauth");
    const handle = await this.runtime.beginLogin();
    const challenge = handle.publicState ? handle.publicState() : handle;
    const flow = { id: randomUUID(), ownerId: subject.user.id, mode, accountId, status: "pending", handle, ...challenge, expiresAt: challenge.expiresAt || new Date(this.now().getTime() + this.ttlMs).toISOString() };
    this.flows.set(flow.id, flow);
    return publicFlow(flow);
  }
  async poll(subject, id) {
    const flow = this.#get(subject, id);
    if (flow.status === "cancelled") throw codexError("CODEX_LOGIN_FLOW_CANCELLED", "登录流程已取消", 410);
    if (Date.parse(flow.expiresAt) <= this.now().getTime()) { await flow.handle?.close?.(); throw codexError("CODEX_LOGIN_FLOW_EXPIRED", "登录流程已过期", 410); }
    if (flow.status === "complete") return publicFlow(flow);
    const result = flow.handle?.poll ? await flow.handle.poll() : await this.runtime.pollLogin(flow);
    if (result.status !== "complete" && !result.auth && !result.authJson) return publicFlow({ ...flow, ...result });
    const auth = result.auth || JSON.parse(result.authJson);
    const account = await this.accountService.importAuth(subject, auth, { email: result.email, id: flow.accountId || undefined });
    flow.status = "complete"; flow.account = account;
    await flow.handle?.close?.();
    return publicFlow(flow);
  }
  async cancel(subject, id) { const flow = this.#get(subject, id); await (flow.handle?.cancel?.() || flow.handle?.close?.()); flow.status = "cancelled"; return publicFlow(flow); }
  #get(subject, id) { const flow = this.flows.get(id); if (!flow || flow.ownerId !== subject.user.id) throw codexError("CODEX_LOGIN_FLOW_NOT_FOUND", "登录流程不存在", 404); return flow; }
}
function publicFlow(flow) { const { ownerId, handle, authJson, auth, ...publicValue } = flow; return publicValue; }
