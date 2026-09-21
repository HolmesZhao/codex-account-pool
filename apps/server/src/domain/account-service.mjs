import { createHash, randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export class AccountService {
  constructor({ repository, permissionService, vault }) { this.repository = repository; this.permissionService = permissionService; this.vault = vault; }

  async list(subject) {
    await this.permissionService.require(subject, "codex_account:read");
    const accounts = await this.repository.listAccounts();
    const allowed = subject.user.role === "admin"
      ? new Set(accounts.map((account) => account.id))
      : new Set(await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] }));
    const visible = accounts.filter((account) => allowed.has(account.id));
    return Promise.all(visible.map(async (account) => ({ ...account, usage: (await this.repository.getLatestQuota(account.id))?.payload || null })));
  }

  async get(subject, accountId, action = "codex_account:read") {
    await this.permissionService.require(subject, action);
    const account = await this.repository.getAccount(accountId);
    if (!account || !(await this.canAccess(subject, accountId))) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    return account;
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
    const id = existing?.id || metadata.id || randomUUID();
    const account = await this.repository.saveAccount({ id, email, alias: metadata.alias || existing?.alias || "", enabled: true, status: "ready", generation: existing?.generation || 0, credentialMode: "legacy" });
    const generation = account.generation + 1;
    const activeKey = (await this.repository.listCredentialKeys()).find((key) => key.active);
    const keyVersion = activeKey?.version || 1;
    const encrypted = JSON.stringify(this.vault.encrypt(auth, { accountId: id, generation, keyVersion }));
    const sha256 = createHash("sha256").update(JSON.stringify(auth)).digest("hex");
    const revision = await this.repository.commitRevision({ accountId: id, expectedGeneration: account.generation, revision: { encrypted, sha256, keyVersion, mode: auth.tokens.refresh_token ? "legacy" : "at-only" } });
    await this.repository.appendAudit({ actorId: subject.user.id, action: existing ? "account.reauth" : "account.import", targetType: "account", targetId: id, result: "success" });
    return { ...(await this.repository.getAccount(id)), generation: revision.generation };
  }

  async update(subject, accountId, patch) {
    const account = await this.get(subject, accountId, "codex_account:manage");
    const updated = await this.repository.saveAccount({ ...account, alias: patch.alias ?? account.alias, enabled: patch.enabled ?? account.enabled, status: patch.status ?? account.status });
    await this.repository.appendAudit({ actorId: subject.user.id, action: "account.update", targetType: "account", targetId: accountId, result: "success", details: { enabled: updated.enabled } });
    return updated;
  }

  async remove(subject, accountId) {
    await this.get(subject, accountId, "codex_account:manage");
    await this.repository.deleteAccount(accountId);
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
