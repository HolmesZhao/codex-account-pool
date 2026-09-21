import pg from "pg";

export function openPostgresDatabase(connectionString, { schema = "codex_pool" } = {}) {
  const pool = new pg.Pool({ connectionString });
  return { pool, schema: schema.replace(/[^a-zA-Z0-9_]/g, "") };
}
