import { randomUUID } from "node:crypto";
import { authMetadata } from "./credential-renewal.mjs";
import { createHash, randomBytes } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export class CredentialService {
  constructor({ repository, permissionService, vault, renewal = null, ticketTtlMs = 60_000, now = () => new Date() }) {
    this.repository = repository; this.permissionService = permissionService; this.vault = vault; this.renewal = renewal; this.ticketTtlMs = ticketTtlMs; this.now = now;
  }

  async issueDownloadTicket(subject, accountId, mode = "at-only") {
    await this.permissionService.require(subject, mode === "raw" ? "codex_account:raw_export" : "codex_account:use");
    await requireAccess(this.repository, subject, accountId);
    const revision = await this.repository.getRevision(accountId);
    if (!revision) throw codexError("CODEX_CREDENTIAL_NOT_FOUND", "账号凭证不存在", 404);
    const auth = this.vault.decrypt(JSON.parse(revision.encrypted), { accountId, generation: revision.generation, keyVersion: revision.keyVersion });
    if (Date.parse(authMetadata(auth).tokenExpiresAt) <= this.now().getTime()) throw codexError("CODEX_ACCOUNT_REAUTH_REQUIRED", "当前 AT 已过期，请维护凭证或重新登录", 409);
    const token = randomBytes(32).toString("base64url");
    await this.repository.saveTicket({ digest: digest(token), userId: subject.user.id, fingerprint: subject.authFingerprint, accountId, generation: revision.generation, mode, expiresAt: new Date(this.now().getTime() + this.ticketTtlMs).toISOString() });
    return { token, generation: revision.generation, downloadUrl: `/api/codex/${mode === "raw" ? "raw-download-tickets" : "download-tickets"}/${encodeURIComponent(token)}`, expiresAt: new Date(this.now().getTime() + this.ticketTtlMs).toISOString() };
  }

  async consumeDownloadTicket(subject, token, mode = "at-only") {
    await this.permissionService.require(subject, mode === "raw" ? "codex_account:raw_export" : "codex_account:use");
    const ticket = await this.repository.consumeTicket({ digest: digest(token), userId: subject.user.id, fingerprint: subject.authFingerprint, mode, now: this.now().toISOString() });
    if (!ticket) throw codexError("CODEX_DOWNLOAD_TICKET_INVALID", "下载票据无效、过期或已使用", 410);
    const revision = await this.repository.getRevision(ticket.accountId, ticket.generation);
    if (!revision) throw codexError("CODEX_DOWNLOAD_TICKET_INVALID", "凭证已更新，请重新申请下载", 410);
    const auth = this.vault.decrypt(JSON.parse(revision.encrypted), { accountId: ticket.accountId, generation: ticket.generation, keyVersion: revision.keyVersion });
    if (Date.parse(authMetadata(auth).tokenExpiresAt) <= this.now().getTime()) throw codexError("CODEX_ACCOUNT_REAUTH_REQUIRED", "当前 AT 已过期", 409);
    return { accountId: ticket.accountId, generation: ticket.generation, sha256: revision.sha256, auth: mode === "raw" ? auth : toAtOnlyAuth(auth) };
  }

  async inspect(subject, accountId) {
    await this.permissionService.require(subject, "codex_account:read");
    await requireAccess(this.repository, subject, accountId);
    const revision = await this.repository.getRevision(accountId);
    if (!revision) throw codexError("CODEX_CREDENTIAL_NOT_FOUND", "账号凭证不存在", 404);
    this.vault.decrypt(JSON.parse(revision.encrypted), { accountId, generation: revision.generation, keyVersion: revision.keyVersion });
    return { valid: true, generation: revision.generation, mode: revision.mode, sha256: revision.sha256 };
  }

  async rotateKey(subject) {
    await this.permissionService.require(subject, "admin:manage");
    const keys = await this.repository.listCredentialKeys();
    const active = keys.find((key) => key.active) || { version: 1, encryptedKey: "external" };
    const nextVersion = Math.max(0, ...keys.map((key) => key.version)) + 1;
    const accounts = await this.repository.listAccounts();
    const owner = randomUUID(), acquired = [];
    try {
      for (const account of [...accounts].sort((a,b) => a.id.localeCompare(b.id))) {
        const now = this.now();
        if (!await this.repository.acquireCredentialLease(account.id, owner, new Date(now.getTime() + 300_000).toISOString(), now.toISOString())) throw codexError("CODEX_CREDENTIAL_BUSY", "账号凭证正在维护，请稍后轮换密钥", 409);
        acquired.push(account.id);
      }
    await this.repository.transaction(async () => {
      for (const key of keys) if (key.active) await this.repository.saveCredentialKey({ ...key, active: false });
      await this.repository.saveCredentialKey({ version: nextVersion, encryptedKey: `derived:v${nextVersion}`, active: true });
      for (const account of accounts) {
        const revision = await this.repository.getRevision(account.id);
        if (!revision) continue;
        const auth = this.vault.decrypt(JSON.parse(revision.encrypted), { accountId: account.id, generation: revision.generation, keyVersion: revision.keyVersion });
        const generation = revision.generation + 1;
        const encrypted = JSON.stringify(this.vault.encrypt(auth, { accountId: account.id, generation, keyVersion: nextVersion }));
        await this.repository.commitRevision({ accountId: account.id, expectedGeneration: revision.generation, leaseOwner: owner, revision: { encrypted, sha256: revision.sha256, keyVersion: nextVersion, mode: revision.mode } });
      }
      await this.repository.appendAudit({ actorId: subject.user.id, action: "credential_key.rotate", targetType: "credential_key", targetId: String(nextVersion), result: "success", details: { previousVersion: active.version, accounts: accounts.length } });
    });
    return { version: nextVersion, active: true, rotatedAccounts: accounts.length };
    } finally { for (const id of acquired) await this.repository.releaseCredentialLease(id, owner); }
  }
}

export function toAtOnlyAuth(authJson) {
  return { ...authJson, tokens: { ...authJson.tokens, refresh_token: "" } };
}

async function requireAccess(repository, subject, accountId) {
  if (subject.user.role === "admin") return;
  const ids = await repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] });
  if (!ids.includes(accountId)) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
