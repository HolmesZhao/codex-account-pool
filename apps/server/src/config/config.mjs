import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function resolveConfig(env = process.env) {
  return {
    host: env.CODEX_POOL_HOST || "127.0.0.1",
    port: Number(env.CODEX_POOL_PORT || 4317),
    databaseUrl: normalizeDatabaseUrl(env.CODEX_POOL_DATABASE_URL || "./data/codex-pool.sqlite"),
    authDatabaseUrl: normalizeDatabaseUrl(env.CODEX_POOL_AUTH_DATABASE_URL || "./data/codex-pool-auth.sqlite"),
    postgresSchema: env.CODEX_POOL_POSTGRES_SCHEMA || "codex_pool",
    sessionSecret: env.CODEX_POOL_SESSION_SECRET || "",
    credentialKey: env.CODEX_POOL_CREDENTIAL_KEY || "",
    admin: env.CODEX_POOL_ADMIN_USERNAME && env.CODEX_POOL_ADMIN_PASSWORD ? { username: env.CODEX_POOL_ADMIN_USERNAME, password: env.CODEX_POOL_ADMIN_PASSWORD } : null,
    codexCommand: env.CODEX_POOL_CODEX_COMMAND || "codex",
    maintenanceDisabled: env.CODEX_POOL_MAINTENANCE_DISABLED === "1",
  };
}
function normalizeDatabaseUrl(value) { return /^postgres(?:ql)?:/i.test(value) || value === ":memory:" ? value : resolve(APP_ROOT, value); }
