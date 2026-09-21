import { DatabaseSync } from "node:sqlite";

export class AuthRepository {
  constructor({ filename = ":memory:" } = {}) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS pool_users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pool_sessions (
        token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, auth_fingerprint TEXT NOT NULL,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES pool_users(id) ON DELETE CASCADE
      );
    `);
  }

  createUser(user) {
    this.db.prepare(`INSERT INTO pool_users
      (id, username, display_name, role, password_hash, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.username, user.displayName, user.role, user.passwordHash, user.enabled ? 1 : 0, user.createdAt);
    return this.findUserById(user.id);
  }

  findUserByUsername(username) {
    return mapUser(this.db.prepare("SELECT * FROM pool_users WHERE username = ?").get(username));
  }

  findUserById(id) {
    return mapUser(this.db.prepare("SELECT * FROM pool_users WHERE id = ?").get(id));
  }

  listUsers() {
    return this.db.prepare("SELECT * FROM pool_users ORDER BY username").all().map(mapUser);
  }

  setUserEnabled(id, enabled) {
    this.db.prepare("UPDATE pool_users SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  updatePassword(id, passwordHash) {
    this.db.prepare("UPDATE pool_users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    this.db.prepare("DELETE FROM pool_sessions WHERE user_id = ?").run(id);
  }

  saveSession(session) {
    this.db.prepare(`INSERT INTO pool_sessions
      (token_digest, user_id, auth_fingerprint, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(session.tokenDigest, session.userId, session.authFingerprint, session.expiresAt, session.createdAt);
  }

  findSession(tokenDigest) {
    return this.db.prepare("SELECT * FROM pool_sessions WHERE token_digest = ?").get(tokenDigest) || null;
  }

  deleteSession(tokenDigest) {
    this.db.prepare("DELETE FROM pool_sessions WHERE token_digest = ?").run(tokenDigest);
  }

  close() { this.db.close(); }
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    passwordHash: row.password_hash,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  };
}
