import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { openSqliteDatabase } from "./sqlite-database.mjs";
import { openPostgresDatabase } from "./postgres-database.mjs";
import { codexError } from "../common/contracts.mjs";

export async function createCodexRepository({ databaseUrl = ":memory:", postgresSchema = "codex_pool" } = {}) {
  if (/^postgres(?:ql)?:/i.test(databaseUrl)) {
    const connection = openPostgresDatabase(databaseUrl, { schema: postgresSchema });
    const repository = new PostgresCodexRepository(connection);
    await repository.initialize();
    return repository;
  }
  return new SqliteCodexRepository(openSqliteDatabase(databaseUrl));
}

export class SqliteCodexRepository {
  constructor(db) {
    this.db = db;
    this.inTransaction = false;
    this.db.exec(SCHEMA_SQLITE);
  }

  async transaction(callback) {
    if (this.inTransaction) return callback();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = await callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally { this.inTransaction = false; }
  }

  savePool(pool) {
    const id = pool.id || randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO codex_pools (id,name,description,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(id, pool.name, pool.description || "", pool.enabled === false ? 0 : 1, pool.createdAt || now, now);
    return this.getPool(id);
  }

  getPool(id) { return mapPool(this.db.prepare("SELECT * FROM codex_pools WHERE id=?").get(id)); }
  listPools() { return this.db.prepare("SELECT * FROM codex_pools ORDER BY name").all().map(mapPool); }
  deletePool(id) { this.db.prepare("DELETE FROM codex_pools WHERE id=?").run(id); }

  saveAccount(account) {
    const id = account.id || randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO codex_accounts (id,email,alias,enabled,status,generation,credential_mode,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,alias=excluded.alias,enabled=excluded.enabled,status=excluded.status,generation=excluded.generation,credential_mode=excluded.credential_mode,updated_at=excluded.updated_at`)
      .run(id, account.email, account.alias || "", account.enabled === false ? 0 : 1, account.status || "ready", account.generation || 0, account.credentialMode || "legacy", account.createdAt || now, now);
    return this.getAccount(id);
  }

  getAccount(id) { return mapAccount(this.db.prepare("SELECT * FROM codex_accounts WHERE id=?").get(id)); }
  listAccounts() { return this.db.prepare("SELECT * FROM codex_accounts ORDER BY email").all().map(mapAccount); }
  deleteAccount(id) { this.db.prepare("DELETE FROM codex_accounts WHERE id=?").run(id); }

  setPoolAccounts(poolId, accountIds) {
    if (!this.inTransaction) this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM codex_pool_accounts WHERE pool_id=?").run(poolId);
      const insert = this.db.prepare("INSERT INTO codex_pool_accounts (pool_id,account_id) VALUES (?,?)");
      for (const id of accountIds) insert.run(poolId, id);
      if (!this.inTransaction) this.db.exec("COMMIT");
    } catch (error) { if (!this.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  getPoolAccountIds(poolId) { return this.db.prepare("SELECT account_id FROM codex_pool_accounts WHERE pool_id=? ORDER BY account_id").all(poolId).map((row) => row.account_id); }

  setPoolSubjects(poolId, subjects) {
    if (!this.inTransaction) this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM codex_pool_subjects WHERE pool_id=?").run(poolId);
      const insert = this.db.prepare("INSERT INTO codex_pool_subjects (pool_id,subject_type,subject_id) VALUES (?,?,?)");
      for (const subject of subjects) insert.run(poolId, subject.type, subject.id);
      if (!this.inTransaction) this.db.exec("COMMIT");
    } catch (error) { if (!this.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  getPoolSubjects(poolId) { return this.db.prepare("SELECT subject_type,subject_id FROM codex_pool_subjects WHERE pool_id=? ORDER BY subject_type,subject_id").all(poolId).map((row) => ({ type: row.subject_type, id: row.subject_id })); }

  listAccessibleAccountIds({ userId, roles = [] }) {
    const subjectIds = [userId, ...roles];
    if (!subjectIds.length) return [];
    const placeholders = subjectIds.map(() => "?").join(",");
    return this.db.prepare(`SELECT DISTINCT pa.account_id FROM codex_pool_accounts pa
      JOIN codex_pool_subjects ps ON ps.pool_id=pa.pool_id
      JOIN codex_pools p ON p.id=pa.pool_id
      WHERE p.enabled=1 AND ps.subject_id IN (${placeholders}) ORDER BY pa.account_id`).all(...subjectIds).map((row) => row.account_id);
  }

  saveCredentialKey(key) {
    this.db.prepare("INSERT INTO codex_credential_keys (version,encrypted_key,active,created_at) VALUES (?,?,?,?) ON CONFLICT(version) DO UPDATE SET encrypted_key=excluded.encrypted_key,active=excluded.active")
      .run(key.version, key.encryptedKey, key.active ? 1 : 0, key.createdAt || new Date().toISOString());
  }
  listCredentialKeys() { return this.db.prepare("SELECT * FROM codex_credential_keys ORDER BY version").all().map((row) => ({ version: row.version, encryptedKey: row.encrypted_key, active: Boolean(row.active), createdAt: row.created_at })); }

  commitRevision({ accountId, expectedGeneration, revision, maintenance, leaseOwner, now = new Date().toISOString() }) {
    if (!this.inTransaction) this.db.exec("BEGIN IMMEDIATE");
    try {
      if (leaseOwner && !this.db.prepare("SELECT 1 FROM codex_credential_leases WHERE account_id=? AND owner=? AND expires_at>?").get(accountId, leaseOwner, now)) throw codexError("CODEX_CREDENTIAL_LEASE_LOST", "凭证维护租约已失效", 409);
      const account = this.db.prepare("SELECT generation FROM codex_accounts WHERE id=?").get(accountId);
      if (!account || account.generation !== expectedGeneration) throw codexError("CODEX_AUTH_REVISION_CONFLICT", "凭证已被其他操作更新", 409);
      const generation = expectedGeneration + 1;
      this.db.prepare(`INSERT INTO codex_auth_revisions
        (account_id,generation,encrypted,sha256,key_version,mode,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(accountId, generation, revision.encrypted, revision.sha256, revision.keyVersion, revision.mode || "legacy", new Date().toISOString());
      this.db.prepare("UPDATE codex_accounts SET generation=?,credential_mode=?,updated_at=? WHERE id=?")
        .run(generation, revision.mode || "legacy", new Date().toISOString(), accountId);
      this.db.prepare(`DELETE FROM codex_auth_revisions WHERE account_id=? AND generation NOT IN
        (SELECT generation FROM codex_auth_revisions WHERE account_id=? ORDER BY generation DESC LIMIT 5)`).run(accountId, accountId);
      if (maintenance) this.db.prepare("INSERT INTO codex_maintenance (account_id,payload) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload").run(accountId, JSON.stringify(maintenance));
      if (!this.inTransaction) this.db.exec("COMMIT");
      return { accountId, generation, ...revision };
    } catch (error) { if (!this.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  getRevision(accountId, generation = null) {
    const row = generation == null
      ? this.db.prepare("SELECT * FROM codex_auth_revisions WHERE account_id=? ORDER BY generation DESC LIMIT 1").get(accountId)
      : this.db.prepare("SELECT * FROM codex_auth_revisions WHERE account_id=? AND generation=?").get(accountId, generation);
    return row ? mapRevision(row) : null;
  }
  listRevisions(accountId) { return this.db.prepare("SELECT * FROM codex_auth_revisions WHERE account_id=? ORDER BY generation DESC").all(accountId).map(mapRevision); }
  listAllRevisions() { return this.db.prepare("SELECT * FROM codex_auth_revisions ORDER BY account_id,generation").all().map(mapRevision); }

  saveQuotaSnapshot(snapshot) {
    const id = snapshot.id || randomUUID();
    this.db.prepare("INSERT INTO codex_quota_snapshots (id,account_id,payload,collected_at,stale,error) VALUES (?,?,?,?,?,?)")
      .run(id, snapshot.accountId, JSON.stringify(snapshot.payload), snapshot.collectedAt || new Date().toISOString(), snapshot.stale ? 1 : 0, snapshot.error || "");
    return { ...snapshot, id };
  }
  getLatestQuota(accountId) { const row = this.db.prepare("SELECT * FROM codex_quota_snapshots WHERE account_id=? ORDER BY collected_at DESC LIMIT 1").get(accountId); return row ? mapQuota(row) : null; }
  listQuotaSnapshots() { return this.db.prepare("SELECT * FROM codex_quota_snapshots ORDER BY collected_at").all().map(mapQuota); }

  saveQuotaActivation(value) {
    const id = value.id || randomUUID();
    this.db.prepare("INSERT INTO codex_quota_activations (id,account_id,window_key,status,activated_at,payload) VALUES (?,?,?,?,?,?)")
      .run(id, value.accountId, value.windowKey, value.status, value.activatedAt || new Date().toISOString(), JSON.stringify(value.payload || {}));
    return { ...value, id };
  }
  listQuotaActivations() { return this.db.prepare("SELECT * FROM codex_quota_activations ORDER BY activated_at").all().map((row) => ({ id: row.id, accountId: row.account_id, windowKey: row.window_key, status: row.status, activatedAt: row.activated_at, payload: JSON.parse(row.payload) })); }

  saveTicket(ticket) {
    this.db.prepare(`INSERT INTO codex_download_tickets
      (digest,user_id,fingerprint,account_id,generation,mode,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(ticket.digest, ticket.userId, ticket.fingerprint, ticket.accountId, ticket.generation, ticket.mode, ticket.expiresAt, ticket.createdAt || new Date().toISOString());
  }

  consumeTicket({ digest, userId, fingerprint, mode, now = new Date().toISOString() }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`SELECT * FROM codex_download_tickets
        WHERE digest=? AND user_id=? AND fingerprint=? AND mode=? AND expires_at>?`).get(digest, userId, fingerprint, mode, now);
      if (row) this.db.prepare("DELETE FROM codex_download_tickets WHERE digest=?").run(digest);
      this.db.exec("COMMIT");
      return row ? { digest: row.digest, userId: row.user_id, fingerprint: row.fingerprint, accountId: row.account_id, generation: row.generation, mode: row.mode, expiresAt: row.expires_at } : null;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  appendAudit(event) {
    this.db.prepare(`INSERT INTO codex_operation_audit
      (id,actor_id,action,target_type,target_id,result,details,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(event.id || randomUUID(), event.actorId || "system", event.action, event.targetType, event.targetId || "", event.result || "success", JSON.stringify(event.details || {}), event.createdAt || new Date().toISOString());
  }
  listAudits({ limit = 100 } = {}) { return this.db.prepare("SELECT * FROM codex_operation_audit ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => ({ id: row.id, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, result: row.result, details: JSON.parse(row.details), createdAt: row.created_at })); }
  getMaintenance(accountId) { const row = this.db.prepare("SELECT payload FROM codex_maintenance WHERE account_id=?").get(accountId); return row ? JSON.parse(row.payload) : null; }
  saveMaintenance(accountId, payload, { owner, generation, now = new Date().toISOString() }) {
    const result = this.db.prepare(`INSERT INTO codex_maintenance (account_id,payload)
      SELECT ?,? WHERE EXISTS (SELECT 1 FROM codex_credential_leases l JOIN codex_accounts a ON a.id=l.account_id WHERE l.account_id=? AND l.owner=? AND l.expires_at>? AND a.generation=?)
      ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload`).run(accountId, JSON.stringify(payload), accountId, owner, now, generation);
    if (!result.changes) throw codexError("CODEX_AUTH_REVISION_CONFLICT", "凭证或租约已更新", 409);
  }
  acquireCredentialLease(accountId, owner, expiresAt, now) {
    return Boolean(this.db.prepare(`INSERT INTO codex_credential_leases (account_id,owner,expires_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE codex_credential_leases.expires_at<=?`).run(accountId, owner, expiresAt, now).changes);
  }
  releaseCredentialLease(accountId, owner) { this.db.prepare("DELETE FROM codex_credential_leases WHERE account_id=? AND owner=?").run(accountId, owner); }
  close() { this.db.close(); }
}

export class PostgresCodexRepository {
  constructor({ pool, schema }) {
    this.rawPool = pool;
    this.transactions = new AsyncLocalStorage();
    this.pool = {
      query: (...args) => (this.transactions.getStore() || this.rawPool).query(...args),
      connect: (...args) => this.rawPool.connect(...args),
    };
    this.schema = schema;
  }
  async initialize() {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.pool.query(SCHEMA_POSTGRES.replaceAll("__SCHEMA__", this.schema));
  }

  async savePool(pool) {
    const id = pool.id || randomUUID();
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(`INSERT INTO ${this.schema}.codex_pools (id,name,description,enabled,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at RETURNING *`,
      [id, pool.name, pool.description || "", pool.enabled !== false, pool.createdAt || now, now]);
    return mapPool(rows[0]);
  }
  async getPool(id) { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_pools WHERE id=$1`, [id]); return mapPool(rows[0]); }
  async listPools() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_pools ORDER BY name`); return rows.map(mapPool); }
  async deletePool(id) { await this.pool.query(`DELETE FROM ${this.schema}.codex_pools WHERE id=$1`, [id]); }

  async saveAccount(account) {
    const id = account.id || randomUUID();
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(`INSERT INTO ${this.schema}.codex_accounts (id,email,alias,enabled,status,generation,credential_mode,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,alias=EXCLUDED.alias,enabled=EXCLUDED.enabled,status=EXCLUDED.status,generation=EXCLUDED.generation,credential_mode=EXCLUDED.credential_mode,updated_at=EXCLUDED.updated_at RETURNING *`,
      [id, account.email, account.alias || "", account.enabled !== false, account.status || "ready", account.generation || 0, account.credentialMode || "legacy", account.createdAt || now, now]);
    return mapAccount(rows[0]);
  }
  async getAccount(id) { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_accounts WHERE id=$1`, [id]); return mapAccount(rows[0]); }
  async listAccounts() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_accounts ORDER BY email`); return rows.map(mapAccount); }
  async deleteAccount(id) { await this.pool.query(`DELETE FROM ${this.schema}.codex_accounts WHERE id=$1`, [id]); }

  async setPoolAccounts(poolId, accountIds) {
    await this.#transaction(async (client) => {
      await client.query(`DELETE FROM ${this.schema}.codex_pool_accounts WHERE pool_id=$1`, [poolId]);
      for (const accountId of accountIds) await client.query(`INSERT INTO ${this.schema}.codex_pool_accounts (pool_id,account_id) VALUES ($1,$2)`, [poolId, accountId]);
    });
  }
  async getPoolAccountIds(poolId) { const { rows } = await this.pool.query(`SELECT account_id FROM ${this.schema}.codex_pool_accounts WHERE pool_id=$1 ORDER BY account_id`, [poolId]); return rows.map((row) => row.account_id); }
  async setPoolSubjects(poolId, subjects) {
    await this.#transaction(async (client) => {
      await client.query(`DELETE FROM ${this.schema}.codex_pool_subjects WHERE pool_id=$1`, [poolId]);
      for (const subject of subjects) await client.query(`INSERT INTO ${this.schema}.codex_pool_subjects (pool_id,subject_type,subject_id) VALUES ($1,$2,$3)`, [poolId, subject.type, subject.id]);
    });
  }
  async getPoolSubjects(poolId) { const { rows } = await this.pool.query(`SELECT subject_type,subject_id FROM ${this.schema}.codex_pool_subjects WHERE pool_id=$1 ORDER BY subject_type,subject_id`, [poolId]); return rows.map((row) => ({ type: row.subject_type, id: row.subject_id })); }
  async listAccessibleAccountIds({ userId, roles = [] }) {
    const subjectIds = [userId, ...roles];
    if (!subjectIds.length) return [];
    const { rows } = await this.pool.query(`SELECT DISTINCT pa.account_id FROM ${this.schema}.codex_pool_accounts pa
      JOIN ${this.schema}.codex_pool_subjects ps ON ps.pool_id=pa.pool_id
      JOIN ${this.schema}.codex_pools p ON p.id=pa.pool_id
      WHERE p.enabled=true AND ps.subject_id = ANY($1::text[]) ORDER BY pa.account_id`, [subjectIds]);
    return rows.map((row) => row.account_id);
  }

  async saveCredentialKey(key) { await this.pool.query(`INSERT INTO ${this.schema}.codex_credential_keys (version,encrypted_key,active,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT(version) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,active=EXCLUDED.active`, [key.version, key.encryptedKey, Boolean(key.active), key.createdAt || new Date().toISOString()]); }
  async listCredentialKeys() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_credential_keys ORDER BY version`); return rows.map((row) => ({ version: row.version, encryptedKey: row.encrypted_key, active: Boolean(row.active), createdAt: iso(row.created_at) })); }

  async commitRevision({ accountId, expectedGeneration, revision, maintenance, leaseOwner, now = new Date().toISOString() }) {
    return this.#transaction(async (client) => {
      if (leaseOwner) {
        const lease = await client.query(`SELECT 1 FROM ${this.schema}.codex_credential_leases WHERE account_id=$1 AND owner=$2 AND expires_at>$3 FOR UPDATE`, [accountId, leaseOwner, now]);
        if (!lease.rows.length) throw codexError("CODEX_CREDENTIAL_LEASE_LOST", "凭证维护租约已失效", 409);
      }
      const { rows } = await client.query(`SELECT generation FROM ${this.schema}.codex_accounts WHERE id=$1 FOR UPDATE`, [accountId]);
      if (!rows[0] || rows[0].generation !== expectedGeneration) throw codexError("CODEX_AUTH_REVISION_CONFLICT", "凭证已被其他操作更新", 409);
      const generation = expectedGeneration + 1;
      await client.query(`INSERT INTO ${this.schema}.codex_auth_revisions (account_id,generation,encrypted,sha256,key_version,mode,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [accountId, generation, revision.encrypted, revision.sha256, revision.keyVersion, revision.mode || "legacy", new Date().toISOString()]);
      await client.query(`UPDATE ${this.schema}.codex_accounts SET generation=$1,credential_mode=$2,updated_at=$3 WHERE id=$4`, [generation, revision.mode || "legacy", new Date().toISOString(), accountId]);
      await client.query(`DELETE FROM ${this.schema}.codex_auth_revisions WHERE account_id=$1 AND generation NOT IN (SELECT generation FROM ${this.schema}.codex_auth_revisions WHERE account_id=$1 ORDER BY generation DESC LIMIT 5)`, [accountId]);
      if (maintenance) await client.query(`INSERT INTO ${this.schema}.codex_maintenance (account_id,payload) VALUES ($1,$2) ON CONFLICT(account_id) DO UPDATE SET payload=EXCLUDED.payload`, [accountId, maintenance]);
      return { accountId, generation, ...revision };
    });
  }
  async getRevision(accountId, generation = null) {
    const query = generation == null
      ? [`SELECT * FROM ${this.schema}.codex_auth_revisions WHERE account_id=$1 ORDER BY generation DESC LIMIT 1`, [accountId]]
      : [`SELECT * FROM ${this.schema}.codex_auth_revisions WHERE account_id=$1 AND generation=$2`, [accountId, generation]];
    const { rows } = await this.pool.query(...query); return rows[0] ? mapRevision(rows[0]) : null;
  }
  async listRevisions(accountId) { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_auth_revisions WHERE account_id=$1 ORDER BY generation DESC`, [accountId]); return rows.map(mapRevision); }
  async listAllRevisions() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_auth_revisions ORDER BY account_id,generation`); return rows.map(mapRevision); }

  async saveQuotaSnapshot(snapshot) {
    const value = { ...snapshot, id: snapshot.id || randomUUID() };
    await this.pool.query(`INSERT INTO ${this.schema}.codex_quota_snapshots (id,account_id,payload,collected_at,stale,error) VALUES ($1,$2,$3,$4,$5,$6)`, [value.id, value.accountId, value.payload, value.collectedAt || new Date().toISOString(), Boolean(value.stale), value.error || ""]);
    return value;
  }
  async getLatestQuota(accountId) { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_quota_snapshots WHERE account_id=$1 ORDER BY collected_at DESC LIMIT 1`, [accountId]); return rows[0] ? mapQuota(rows[0]) : null; }
  async listQuotaSnapshots() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_quota_snapshots ORDER BY collected_at`); return rows.map(mapQuota); }
  async saveQuotaActivation(value) { const result = { ...value, id: value.id || randomUUID() }; await this.pool.query(`INSERT INTO ${this.schema}.codex_quota_activations (id,account_id,window_key,status,activated_at,payload) VALUES ($1,$2,$3,$4,$5,$6)`, [result.id, result.accountId, result.windowKey, result.status, result.activatedAt || new Date().toISOString(), result.payload || {}]); return result; }
  async listQuotaActivations() { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_quota_activations ORDER BY activated_at`); return rows.map((row) => ({ id: row.id, accountId: row.account_id, windowKey: row.window_key, status: row.status, activatedAt: iso(row.activated_at), payload: json(row.payload) })); }

  async saveTicket(ticket) { await this.pool.query(`INSERT INTO ${this.schema}.codex_download_tickets (digest,user_id,fingerprint,account_id,generation,mode,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [ticket.digest, ticket.userId, ticket.fingerprint, ticket.accountId, ticket.generation, ticket.mode, ticket.expiresAt, ticket.createdAt || new Date().toISOString()]); }
  async consumeTicket({ digest, userId, fingerprint, mode, now = new Date().toISOString() }) {
    return this.#transaction(async (client) => {
      const { rows } = await client.query(`DELETE FROM ${this.schema}.codex_download_tickets WHERE digest=$1 AND user_id=$2 AND fingerprint=$3 AND mode=$4 AND expires_at>$5 RETURNING *`, [digest, userId, fingerprint, mode, now]);
      const row = rows[0];
      return row ? { digest: row.digest, userId: row.user_id, fingerprint: row.fingerprint, accountId: row.account_id, generation: row.generation, mode: row.mode, expiresAt: iso(row.expires_at) } : null;
    });
  }
  async appendAudit(event) { await this.pool.query(`INSERT INTO ${this.schema}.codex_operation_audit (id,actor_id,action,target_type,target_id,result,details,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [event.id || randomUUID(), event.actorId || "system", event.action, event.targetType, event.targetId || "", event.result || "success", event.details || {}, event.createdAt || new Date().toISOString()]); }
  async listAudits({ limit = 100 } = {}) { const { rows } = await this.pool.query(`SELECT * FROM ${this.schema}.codex_operation_audit ORDER BY created_at DESC LIMIT $1`, [limit]); return rows.map((row) => ({ id: row.id, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, result: row.result, details: json(row.details), createdAt: iso(row.created_at) })); }

  async transaction(callback) { return this.#transaction(callback); }
  async #transaction(callback) {
    const active = this.transactions.getStore();
    if (active) return callback(active);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await this.transactions.run(client, () => callback(client));
      await client.query("COMMIT");
      return value;
    }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async getMaintenance(accountId) { const { rows } = await this.pool.query(`SELECT payload FROM ${this.schema}.codex_maintenance WHERE account_id=$1`, [accountId]); return rows[0] ? json(rows[0].payload) : null; }
  async saveMaintenance(accountId, payload, { owner, generation, now = new Date().toISOString() }) {
    await this.#transaction(async client => {
      const lease = await client.query(`SELECT 1 FROM ${this.schema}.codex_credential_leases WHERE account_id=$1 AND owner=$2 AND expires_at>$3 FOR UPDATE`, [accountId, owner, now]);
      const account = await client.query(`SELECT generation FROM ${this.schema}.codex_accounts WHERE id=$1 FOR UPDATE`, [accountId]);
      if (!lease.rows.length || account.rows[0]?.generation !== generation) throw codexError("CODEX_AUTH_REVISION_CONFLICT", "凭证或租约已更新", 409);
      await client.query(`INSERT INTO ${this.schema}.codex_maintenance (account_id,payload) VALUES ($1,$2) ON CONFLICT(account_id) DO UPDATE SET payload=EXCLUDED.payload`, [accountId, payload]);
    });
  }
  async acquireCredentialLease(accountId, owner, expiresAt, now) {
    const { rowCount } = await this.pool.query(`INSERT INTO ${this.schema}.codex_credential_leases (account_id,owner,expires_at) VALUES ($1,$2,$3)
      ON CONFLICT(account_id) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE ${this.schema}.codex_credential_leases.expires_at<=$4`, [accountId, owner, expiresAt, now]);
    return Boolean(rowCount);
  }
  async releaseCredentialLease(accountId, owner) { await this.pool.query(`DELETE FROM ${this.schema}.codex_credential_leases WHERE account_id=$1 AND owner=$2`, [accountId, owner]); }
  async close() { await this.rawPool.end(); }
}

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS codex_maintenance (account_id TEXT PRIMARY KEY REFERENCES codex_accounts(id) ON DELETE CASCADE,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_credential_leases (account_id TEXT PRIMARY KEY REFERENCES codex_accounts(id) ON DELETE CASCADE,owner TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_pools (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_accounts (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,alias TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,credential_mode TEXT NOT NULL DEFAULT 'legacy',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_pool_accounts (pool_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(pool_id,account_id),FOREIGN KEY(pool_id) REFERENCES codex_pools(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES codex_accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codex_pool_subjects (pool_id TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id TEXT NOT NULL,PRIMARY KEY(pool_id,subject_type,subject_id),FOREIGN KEY(pool_id) REFERENCES codex_pools(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codex_credential_keys (version INTEGER PRIMARY KEY,encrypted_key TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_auth_revisions (account_id TEXT NOT NULL,generation INTEGER NOT NULL,encrypted TEXT NOT NULL,sha256 TEXT NOT NULL,key_version INTEGER NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,generation),FOREIGN KEY(account_id) REFERENCES codex_accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codex_quota_snapshots (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,payload TEXT NOT NULL,collected_at TEXT NOT NULL,stale INTEGER NOT NULL,error TEXT NOT NULL,FOREIGN KEY(account_id) REFERENCES codex_accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codex_quota_activations (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,window_key TEXT NOT NULL,status TEXT NOT NULL,activated_at TEXT NOT NULL,payload TEXT NOT NULL,FOREIGN KEY(account_id) REFERENCES codex_accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codex_download_tickets (digest TEXT PRIMARY KEY,user_id TEXT NOT NULL,fingerprint TEXT NOT NULL,account_id TEXT NOT NULL,generation INTEGER NOT NULL,mode TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_operation_audit (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,result TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
`;

const SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_pools (id text PRIMARY KEY,name text NOT NULL,description text NOT NULL DEFAULT '',enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_accounts (id text PRIMARY KEY,email text UNIQUE NOT NULL,alias text NOT NULL DEFAULT '',enabled boolean NOT NULL DEFAULT true,status text NOT NULL,generation integer NOT NULL DEFAULT 0,credential_mode text NOT NULL DEFAULT 'legacy',created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_maintenance (account_id text PRIMARY KEY REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_credential_leases (account_id text PRIMARY KEY REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,owner text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_pool_accounts (pool_id text REFERENCES __SCHEMA__.codex_pools(id) ON DELETE CASCADE,account_id text REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,PRIMARY KEY(pool_id,account_id));
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_pool_subjects (pool_id text REFERENCES __SCHEMA__.codex_pools(id) ON DELETE CASCADE,subject_type text NOT NULL,subject_id text NOT NULL,PRIMARY KEY(pool_id,subject_type,subject_id));
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_credential_keys (version integer PRIMARY KEY,encrypted_key text NOT NULL,active boolean NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_auth_revisions (account_id text REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,generation integer NOT NULL,encrypted text NOT NULL,sha256 text NOT NULL,key_version integer NOT NULL,mode text NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(account_id,generation));
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_quota_snapshots (id text PRIMARY KEY,account_id text REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,payload jsonb NOT NULL,collected_at timestamptz NOT NULL,stale boolean NOT NULL,error text NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_quota_activations (id text PRIMARY KEY,account_id text REFERENCES __SCHEMA__.codex_accounts(id) ON DELETE CASCADE,window_key text NOT NULL,status text NOT NULL,activated_at timestamptz NOT NULL,payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_download_tickets (digest text PRIMARY KEY,user_id text NOT NULL,fingerprint text NOT NULL,account_id text NOT NULL,generation integer NOT NULL,mode text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS __SCHEMA__.codex_operation_audit (id text PRIMARY KEY,actor_id text NOT NULL,action text NOT NULL,target_type text NOT NULL,target_id text NOT NULL,result text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL);
`;

function mapPool(row) { return row ? { id: row.id, name: row.name, description: row.description, enabled: Boolean(row.enabled), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null; }
function mapAccount(row) { return row ? { id: row.id, email: row.email, alias: row.alias, enabled: Boolean(row.enabled), status: row.status, generation: row.generation, credentialMode: row.credential_mode, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null; }
function mapRevision(row) { return { accountId: row.account_id, generation: row.generation, encrypted: row.encrypted, sha256: row.sha256, keyVersion: row.key_version, mode: row.mode, createdAt: iso(row.created_at) }; }
function mapQuota(row) { return { id: row.id, accountId: row.account_id, payload: json(row.payload), collectedAt: iso(row.collected_at), stale: Boolean(row.stale), error: row.error }; }
function json(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function iso(value) { return value instanceof Date ? value.toISOString() : value; }
