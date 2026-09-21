import type { Account, Pool, User, AuditEvent } from "../lib/types";

export const adminUser: User = { id: "admin", username: "admin", displayName: "管理员", role: "admin", enabled: true };
export const accountFixture: Account[] = [
  { id: "acct-a", email: "lin@example.com", alias: "生产主账号", enabled: true, status: "ready", generation: 4, credentialMode: "at-only", updatedAt: "2026-09-21T06:00:00.000Z", usage: { fiveHour: { usedPercent: 42, remainingPercent: 58, resetsAt: "2026-09-21T10:00:00.000Z" }, weekly: { usedPercent: 18, remainingPercent: 82, resetsAt: "2026-09-25T00:00:00.000Z" }, planType: "plus", collectedAt: "2026-09-21T06:10:00.000Z" } },
  { id: "acct-b", email: "ops@example.com", alias: "运维备用", enabled: true, status: "needs_reauth", generation: 2, credentialMode: "legacy", updatedAt: "2026-09-20T06:00:00.000Z", usage: { fiveHour: null, weekly: { usedPercent: 67, remainingPercent: 33 }, planType: "pro", collectedAt: "2026-09-20T06:10:00.000Z", stale: true } },
];
export const poolFixture: Pool[] = [{ id: "pool-a", name: "核心研发池", description: "研发团队日常使用", enabled: true, accountIds: ["acct-a"], subjects: [{ type: "role", id: "developer" }], updatedAt: "2026-09-21T06:00:00.000Z" }];
export const auditFixture: AuditEvent[] = [{ id: "audit-a", actorId: "admin", action: "account.import", targetType: "account", targetId: "acct-a", result: "success", createdAt: "2026-09-21T06:00:00.000Z" }];
