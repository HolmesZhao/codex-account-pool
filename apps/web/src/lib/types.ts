export type Role = "basic_user" | "developer" | "expert" | "admin";
export interface User { id: string; username: string; displayName: string; role: Role; enabled: boolean }
export interface QuotaWindow { usedPercent: number; remainingPercent?: number; resetsAt?: string | null; windowDurationMins?: number | null }
export interface AccountUsage { fiveHour?: QuotaWindow | null; weekly?: QuotaWindow | null; planType?: string | null; primary?: QuotaWindow | null; secondary?: QuotaWindow | null; collectedAt?: string; stale?: boolean; error?: string; needsReauth?: boolean }
export interface CredentialMaintenance { managed: boolean; refreshStatus: string; tokenExpiresAt: string; nextRotationAt: string; lastRenewedAt: string; lastCheckedAt: string; failureCount: number; nextRetryAt: string; lastError: string }
export interface Account { maintenance?: CredentialMaintenance | null; id: string; email: string; alias: string; enabled: boolean; status: string; generation: number; credentialMode: "legacy" | "at-only" | "managed"; usage?: AccountUsage | null; updatedAt?: string }
export interface PoolSubject { type: "user" | "role"; id: string }
export interface Pool { id: string; name: string; description: string; enabled: boolean; accountIds: string[]; subjects: PoolSubject[]; updatedAt?: string }
export interface AuditEvent { id: string; actorId: string; action: string; targetType: string; targetId: string; result: string; createdAt: string }
