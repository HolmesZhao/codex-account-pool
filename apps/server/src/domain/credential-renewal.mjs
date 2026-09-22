import { createHash, randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export function authMetadata(auth) {
  const value = typeof auth === "string" ? JSON.parse(auth) : auth;
  const token = value?.tokens || {};
  const parse = raw => { try { return JSON.parse(Buffer.from(String(raw).split(".")[1], "base64url").toString()); } catch { return {}; } };
  const claims = parse(token.access_token), identityClaims = parse(token.id_token);
  const claimId = claims["https://api.openai.com/auth"]?.chatgpt_account_id || identityClaims["https://api.openai.com/auth"]?.chatgpt_account_id || "";
  const mismatched = claimId && token.account_id && claimId !== token.account_id;
  let expiry = token.expires_at || token.expiresAt || value?.expires_at || value?.expiresAt || (claims.exp ? Number(claims.exp) * 1000 : null);
  if (typeof expiry === "string" && /^\d+(?:\.\d+)?$/.test(expiry)) expiry = Number(expiry);
  if (!expiry && (token.expires_in || value?.expires_in)) {
    const refreshed = Date.parse(value?.last_refresh || token.last_refresh);
    if (Number.isFinite(refreshed)) expiry = refreshed + Number(token.expires_in || value.expires_in) * 1000;
  }
  const date = expiry ? new Date(typeof expiry === "number" && expiry < 100_000_000_000 ? expiry * 1000 : expiry) : null;
  return { tokenExpiresAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : "", hasRefreshToken: Boolean(token.refresh_token), identity: mismatched ? "" : claimId || token.account_id || "" };
}
export function rotationState(accountId, auth, now) {
  const jitter = parseInt(hash(`${accountId}:aac-72-hour-rotation`).slice(0, 8), 16) % 60;
  return { ...initialState(auth), refreshStatus: "healthy", lastRotatedAt: now.toISOString(), lastRenewedAt: now.toISOString(), lastCheckedAt: now.toISOString(), nextRotationAt: new Date(now.getTime() + (71 * 60 + jitter) * 60_000).toISOString() };
}
export function initialState(auth) {
  const meta = authMetadata(auth);
  return { managed: meta.hasRefreshToken, tokenExpiresAt: meta.tokenExpiresAt, refreshStatus: meta.hasRefreshToken ? "pending" : "manual", maintenanceAvailable: true, nextRotationAt: "", lastRotatedAt: "", lastRenewedAt: "", lastCheckedAt: "", failureCount: 0, nextRetryAt: "", lastError: "" };
}
export function permanentFailure(error) { return /invalid_grant|refresh_token_reused|refresh token.*(?:reused|revoked|expired|invalid)|not logged in|not authenticated|authentication required|unauthorized|reauth required/i.test(String(error?.message || error)); }
export function safeFailure(error) { return String(error?.message || error || "凭证维护失败").replace(/((?:https?|socks5h?):\/\/)[^\s/]+@/gi, "$1[REDACTED]@").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/(?:access|refresh|id)[_-]?token\s*["']?\s*[:=]\s*\S+/gi, "token=[REDACTED]").slice(0, 240); }
export function hash(value) { return createHash("sha256").update(value).digest("hex"); }
export async function withCredentialLease(repository, accountId, operation, now = () => new Date()) {
  const owner = randomUUID(), date = now();
  if (!await repository.acquireCredentialLease(accountId, owner, new Date(date.getTime() + 300_000).toISOString(), date.toISOString())) throw codexError("CODEX_CREDENTIAL_BUSY", "账号凭证正在维护，请稍后重试", 409);
  try { return await operation(owner); } finally { await repository.releaseCredentialLease(accountId, owner); }
}

export class CredentialRenewal {
  constructor({ repository, vault, runtime, now = () => new Date() }) { Object.assign(this, { repository, vault, runtime, now }); this.operations = new Map(); this.reconciliations = new Set(); }
  async state(accountId) {
    const saved = await this.repository.getMaintenance(accountId);
    if (saved) return saved;
    const rev = await this.repository.getRevision(accountId);
    return rev ? initialState(this.decode(accountId, rev)) : null;
  }
  decode(accountId, revision) { return this.vault.decrypt(JSON.parse(revision.encrypted), { accountId, generation: revision.generation, keyVersion: revision.keyVersion }); }
  async run(accountId, { quotaOnly = false, force = false, rotate = false } = {}) {
    // Join only equivalent operations; different operations wait then re-read current revision.
    const previous = this.operations.get(accountId);
    if (previous) { if (previous.key === `${quotaOnly}:${force}:${rotate}`) return previous.promise; await previous.promise.catch(() => {}); return this.run(accountId, { quotaOnly, force, rotate }); }
    const promise = withCredentialLease(this.repository, accountId, (owner) => this.perform(accountId, owner, { quotaOnly, force, rotate }), this.now);
    this.operations.set(accountId, { key: `${quotaOnly}:${force}:${rotate}`, promise });
    try { return await promise; } finally { this.operations.delete(accountId); }
  }
  async perform(accountId, owner, { quotaOnly, force, rotate, recover = false, candidate = null }) {
    const account = await this.repository.getAccount(accountId);
    if (!account) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在", 404);
    let revision = await this.repository.getRevision(accountId);
    if (!revision) throw codexError("CODEX_CREDENTIAL_NOT_FOUND", "账号凭证不存在", 404);
    let auth = this.decode(accountId, revision), state = await this.repository.getMaintenance(accountId) || initialState(auth);
    const storedAuth = auth;
    if (candidate) auth = candidate;
    const now = this.now();
    const blocked = ["quarantined", "needs_reauth"].includes(state.refreshStatus);
    const waiting = !force && Date.parse(state.nextRetryAt) > now.getTime();
    const eligible = account.enabled && account.status !== "disabled" && (!blocked || (recover && state.refreshStatus !== "quarantined")) && !waiting && (state.managed || Boolean(candidate));
    const expiry = Date.parse(state.tokenExpiresAt);
    const due = !state.nextRotationAt || Date.parse(state.nextRotationAt) <= now.getTime();
    const refresh = !quotaOnly && eligible && (rotate || due || expiry - now.getTime() < 30 * 60_000);
    if (rotate && !eligible) throw codexError("CODEX_RENEWAL_UNAVAILABLE", "当前账号无法轮换，请检查续期状态或重新登录", 409);
    const inspectOnlyQuota = quotaOnly || !eligible;
    let result;
    try {
      result = this.runtime.inspect ? await this.runtime.inspect(JSON.stringify(auth), { refresh, quotaOnly: inspectOnlyQuota }) : { quota: await this.runtime.readQuota(JSON.stringify(auth)), updatedAuthJson: JSON.stringify(auth), refreshed: false };
    } catch (error) { result = { error: { message: safeFailure(error) } }; }
    let failure = result.error;
    if (result.updatedAuthJson) {
      let updated;
      try { updated = typeof result.updatedAuthJson === "string" ? JSON.parse(result.updatedAuthJson) : result.updatedAuthJson; }
      catch { updated = {}; }
      if (!updated || typeof updated !== "object") updated = {};
      const priorMeta = authMetadata(storedAuth), nextMeta = authMetadata(updated);
      if (!updated.tokens?.access_token || (priorMeta.identity && nextMeta.identity !== priorMeta.identity)) failure = { message: "凭证身份校验失败", quarantine: true };
      else if (candidate && !result.refreshed) failure = { message: "候选凭证未完成上游验证，请重新登录" };
      else {
        const changed = hash(JSON.stringify(updated)) !== hash(JSON.stringify(storedAuth));
        if (changed) {
          state = nextMeta.hasRefreshToken ? { ...state, ...rotationState(accountId, updated, now) } : { ...state, ...initialState(updated), refreshStatus: "needs_reauth", lastError: "刷新结果缺少 RT，请重新登录" };
          const activeKey = (await this.repository.listCredentialKeys()).find((key) => key.active)?.version || revision.keyVersion;
          const next = { encrypted: JSON.stringify(this.vault.encrypt(updated, { accountId, generation: revision.generation + 1, keyVersion: activeKey })), sha256: hash(JSON.stringify(updated)), keyVersion: activeKey, mode: nextMeta.hasRefreshToken ? "managed" : "at-only" };
          // Persist immediately, including when a later quota read failed.
          revision = await this.repository.commitRevision({ accountId, expectedGeneration: revision.generation, revision: next, maintenance: state, leaseOwner: owner, now: this.now().toISOString() });
          auth = updated;
          await this.repository.appendAudit({ action: "credential.renew", targetType: "account", targetId: accountId, details: { generation: revision.generation } });
        } else if (refresh && result.refreshed && !failure) state = { ...state, ...rotationState(accountId, updated, now) };
      }
    }
    if (failure) {
      // Quota-only errors do not mutate the RT failure/recovery state.
      if (!inspectOnlyQuota || failure.quarantine) {
        const count = state.failureCount + 1;
        const recoverable = permanentFailure(failure) && Date.parse(state.tokenExpiresAt) - now.getTime() > 48 * 3600_000;
        const lost = ["awaiting_client_reconcile", "refresh_chain_lost"].includes(state.refreshStatus);
        state = { ...state, lastCheckedAt: now.toISOString(), failureCount: count, lastError: safeFailure(failure), maintenanceAvailable: !/ENOENT|not found|unsupported|method not found/i.test(safeFailure(failure)), refreshStatus: failure.quarantine ? "quarantined" : recoverable ? (lost ? "refresh_chain_lost" : "awaiting_client_reconcile") : permanentFailure(failure) ? "needs_reauth" : "retrying", nextRetryAt: recoverable ? new Date(Math.max(now.getTime() + 3600_000, Date.parse(state.tokenExpiresAt) - 48 * 3600_000)).toISOString() : permanentFailure(failure) || failure.quarantine ? "" : new Date(now.getTime() + [5, 15, 60][Math.min(count - 1, 2)] * 60_000).toISOString() };
      }
    } else if (!inspectOnlyQuota && !["needs_reauth", "quarantined"].includes(state.refreshStatus)) state = { ...state, lastCheckedAt: now.toISOString(), lastError: "", failureCount: 0, nextRetryAt: "" };
    await this.repository.saveMaintenance(accountId, state, { owner, generation: revision.generation, now: this.now().toISOString() });
    if (failure) await this.repository.appendAudit({ action: "credential.maintenance", targetType: "account", targetId: accountId, result: state.refreshStatus, details: { error: safeFailure(failure) } });
    return { quota: result.quota || null, error: failure ? safeFailure(failure) : "", maintenance: state, generation: revision.generation };
  }
  async reconcile(accountId, input) {
    let candidate;
    try { candidate = typeof input === "string" ? JSON.parse(input) : input; } catch { throw codexError("CODEX_AUTH_JSON_INVALID", "本地凭证格式无效", 400); }
    const operation = withCredentialLease(this.repository, accountId, async (owner) => {
      const revision = await this.repository.getRevision(accountId);
      if (!revision) throw codexError("CODEX_CREDENTIAL_NOT_FOUND", "账号凭证不存在", 404);
      const stored = this.decode(accountId, revision);
      const identity = authMetadata(stored).identity;
      if (!candidate?.tokens?.refresh_token || !identity || authMetadata(candidate).identity !== identity) throw codexError("CODEX_RECONCILE_IDENTITY", "本地凭证不属于当前托管账号", 409);
      const result = await this.perform(accountId, owner, { force: true, rotate: true, recover: true });
      if (!result.error) return { reconciled: true, source: "server", generation: result.generation };
      if (!permanentFailure(result.error)) throw codexError("CODEX_RECONCILE_RETRY", "服务端暂时无法刷新，已保留双方凭证，请稍后重试", 503);
      const trust = (auth) => {
        try {
          const claims = JSON.parse(Buffer.from(auth.tokens.access_token.split(".")[1], "base64url").toString());
          return { key: JSON.stringify([claims.iss, claims.aud, claims.sub, authMetadata(auth).identity]), issuedAt: Number(claims.iat || 0), valid: Boolean(claims.iss && claims.sub) };
        } catch { return { valid: false }; }
      };
      const oldTrust = trust(stored), newTrust = trust(candidate);
      if (!newTrust.valid || !oldTrust.valid || oldTrust.key !== newTrust.key || newTrust.issuedAt <= oldTrust.issuedAt) throw codexError("CODEX_RECONCILE_STALE", "需要同一账号、同一身份来源且更新的本地凭证", 409);
      const adopted = await this.perform(accountId, owner, { force: true, rotate: true, recover: true, candidate });
      if (adopted.error || !adopted.maintenance.managed) throw codexError("CODEX_RECONCILE_FAILED", "候选凭证刷新未完成，请重新登录或稍后重试", 409);
      return { reconciled: true, source: "local", generation: adopted.generation };
    }, this.now);
    this.reconciliations.add(operation);
    try { return await operation; } finally { this.reconciliations.delete(operation); }
  }
  async close() { await Promise.allSettled([...[...this.operations.values()].map((value) => value.promise), ...this.reconciliations]); }
}
