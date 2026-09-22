import { codexError } from "../common/contracts.mjs";
import { normalizeAccountUsageSnapshot } from "./codex-quota-window.mjs";

export class QuotaService {
  constructor({ repository, permissionService, runtime, vault, renewal = null, now = () => new Date() }) { this.repository = repository; this.permissionService = permissionService; this.runtime = runtime; this.vault = vault; this.now = now; this.renewal = renewal; }
  async refresh(subject, accountId, { maintenance = false, force = false, rotate = false } = {}) {
    await this.permissionService.require(subject, "codex_quota:read");
    const target = await this.repository.getAccount(accountId);
    if (!target) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    if (subject.user.role !== "admin") {
      const allowed = await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] });
      if (!allowed.includes(accountId)) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    }
    const previous = (await this.repository.getLatestQuota(accountId))?.payload || null;
    try {
      const account = await this.repository.getAccount(accountId);
      if (!account) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
      if (subject.user.role !== "admin") {
        const allowed = await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] });
        if (!allowed.includes(accountId)) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
      }
      const revision = await this.repository.getRevision(accountId);
      if (!revision) throw codexError("CODEX_CREDENTIAL_NOT_FOUND", "账号凭证不存在", 404);
      const auth = this.vault.decrypt(JSON.parse(revision.encrypted), { accountId, generation: revision.generation, keyVersion: revision.keyVersion });
      const result = this.renewal ? await this.renewal.run(accountId, { quotaOnly: !maintenance, force, rotate }) : null;
      if (result?.error) throw new Error(result.error);
      const current = result ? result.quota : await this.runtime.readQuota(JSON.stringify(auth));
      const payload = normalizeAccountUsageSnapshot(current, { previous, now: this.now() });
      await this.repository.saveQuotaSnapshot({ accountId, payload, collectedAt: payload.collectedAt, stale: false });
      return payload;
    } catch (error) {
      const payload = normalizeAccountUsageSnapshot(null, { previous, now: this.now(), error: error.message });
      await this.repository.saveQuotaSnapshot({ accountId, payload, collectedAt: payload.observedAt, stale: true, error: payload.error });
      return payload;
    }
  }
  async get(subject, accountId) {
    await this.permissionService.require(subject, "codex_quota:read");
    if (subject.user.role !== "admin") {
      const allowed = await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] });
      if (!allowed.includes(accountId)) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "账号不存在或无权访问", 404);
    }
    const value = await this.repository.getLatestQuota(accountId);
    if (!value) throw codexError("CODEX_QUOTA_NOT_FOUND", "尚无额度数据", 404);
    return value.payload;
  }
}
