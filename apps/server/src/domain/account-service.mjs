import { withCredentialLease, initialState } from "./credential-renewal.mjs";
import { createHash, randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export class AccountService {
  constructor({ repository, permissionService, vault, renewal = null }) { this.repository = repository; this.permissionService = permissionService; this.vault = vault; this.renewal = renewal; }

  async list(subject) {
    await this.permissionService.require(subject, "codex_account:read");
    const accounts = await this.repository.listAccounts();
    const allowed = subject.user.role === "admin"
      ? new Set(accounts.map((account) => account.id))
      : new Set(await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] }));
    const visible = accounts.filter((account) => allowed.has(account.id));
    return Promise.all(visible.map(async (account) => ({ ...publicAccount(account, this.renewal ? await this.renewal.state(account.id) : null), usage: (await this.repository.getLatestQuota(account.id))?.payload || null })));
  }

  async get(subject, accountId, action = "codex_account:read") {
    await this.permissionService.require(subject, action);
    const account = await this.repository.getAccount(accountId);
    if (!account || !(await this.canAccess(subject, accountId))) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    return publicAccount(account, this.renewal ? await this.renewal.state(accountId) : null);
  }

  async canAccess(subject, accountId) {
    if (subject.user.role === "admin") return true;
    const ids = await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] });
    return ids.includes(accountId);
  }

  async importAuth(subject, input, metadata = {}) {
    await this.permissionService.require(subject, "codex_account:import");
    const auth = parseAuth(input);
    const email = String(metadata.email || auth.email || auth.account?.email || tokenEmail(auth.tokens?.id_token) || "").trim().toLowerCase();
    if (!email) throw codexError("CODEX_ACCOUNT_EMAIL_REQUIRED", "无法识别账号邮箱", 400);
    const existing = (await this.repository.listAccounts()).find((account) => account.email === email);
    if (existing && !(await this.canAccess(subject, existing.id))) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    if (metadata.id && existing?.id !== metadata.id) throw codexError("CODEX_ACCOUNT_IDENTITY_MISMATCH", "重新登录的账号与原账号不一致", 409);
    const id = existing?.id || randomUUID();
    if (!existing) await this.repository.saveAccount({ id, email, alias: metadata.alias || "", enabled: true, status: "ready", generation: 0, credentialMode: "legacy" });
    await withCredentialLease(this.repository, id, async (owner) => {
      const account = await this.repository.getAccount(id);
      const generation = account.generation + 1;
      const activeKey = (await this.repository.listCredentialKeys()).find((key) => key.active);
      const keyVersion = activeKey?.version || 1;
      const encrypted = JSON.stringify(this.vault.encrypt(auth, { accountId: id, generation, keyVersion }));
      const sha256 = createHash("sha256").update(JSON.stringify(auth)).digest("hex");
      const state = initialState(auth);
      await this.repository.commitRevision({ accountId: id, expectedGeneration: account.generation, revision: { encrypted, sha256, keyVersion, mode: auth.tokens.refresh_token ? "legacy" : "at-only" }, maintenance: state, leaseOwner: owner });
      await this.repository.appendAudit({ actorId: subject.user.id, action: existing ? "account.reauth" : "account.import", targetType: "account", targetId: id, result: "success" });
    });
    // Initial cutover establishes server ownership of the RT chain; failures remain retryable.
    if (auth.tokens.refresh_token && this.renewal) await this.renewal.run(id).catch(() => {});
    return this.get(subject, id);
  }

  async update(subject, accountId, patch) {
    await this.get(subject, accountId, "codex_account:manage");
    return withCredentialLease(this.repository, accountId, async () => {
    const account = await this.repository.getAccount(accountId);
    const updated = await this.repository.saveAccount({ ...account, alias: patch.alias ?? account.alias, enabled: patch.enabled ?? account.enabled, status: patch.status ?? account.status });
    await this.repository.appendAudit({ actorId: subject.user.id, action: "account.update", targetType: "account", targetId: accountId, result: "success", details: { enabled: updated.enabled } });
    return updated;
    });
  }

  async remove(subject, accountId) {
    await this.get(subject, accountId, "codex_account:manage");
    await withCredentialLease(this.repository, accountId, () => this.repository.deleteAccount(accountId));
    await this.repository.appendAudit({ actorId: subject.user.id, action: "account.delete", targetType: "account", targetId: accountId, result: "success" });
  }
}

function parseAuth(input) {
  let auth;
  try { auth = typeof input === "string" ? JSON.parse(input) : structuredClone(input); } catch { throw codexError("CODEX_AUTH_JSON_INVALID", "auth.json 格式无效", 400); }
  if (!auth || typeof auth !== "object" || !auth.tokens || typeof auth.tokens.access_token !== "string" || !auth.tokens.access_token) {
    throw codexError("CODEX_AUTH_JSON_INVALID", "auth.json 缺少有效凭证", 400);
  }
  return auth;
}

function tokenEmail(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")).email || ""; } catch { return ""; }
}

function publicAccount(account, maintenance) {
  const expired = Date.parse(maintenance?.tokenExpiresAt) <= Date.now();
  return { ...account, maintenance, status: maintenance?.refreshStatus === "quarantined" ? "quarantined" : expired ? "needs_reauth" : account.status };
}
