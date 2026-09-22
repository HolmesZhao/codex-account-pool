import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { codexError } from "../common/contracts.mjs";
import { hashPassword, verifyPassword } from "./passwords.mjs";

export class AuthService {
  constructor({ repository, sessionTtlMs = 8 * 60 * 60 * 1000, provenanceSecret, now = () => new Date() } = {}) {
    this.repository = repository;
    this.sessionTtlMs = sessionTtlMs;
    this.provenanceSecret = provenanceSecret || randomBytes(32).toString("hex");
    this.now = now;
  }

  async createUser({ username, password, displayName = username, role = "basic_user", enabled = true }) {
    const normalized = String(username || "").trim().toLowerCase();
    if (typeof username !== "string" || normalized.length > 100 || /\s/.test(normalized)) throw codexError("CODEX_USER_INVALID", "用户名不能包含空格，且不能超过 100 个字符", 400);
    if (typeof password !== "string" || password.length < 10 || password.length > 1024) throw codexError("CODEX_PASSWORD_INVALID", "密码长度应为 10–1024 个字符", 400);
    if (typeof displayName !== "string" || displayName.trim().length > 100) throw codexError("CODEX_USER_INVALID", "显示名称不能超过 100 个字符", 400);
    if (typeof enabled !== "boolean") throw codexError("CODEX_USER_INVALID", "用户状态无效", 400);
    if (this.repository.findUserByUsername(normalized)) throw codexError("CODEX_USER_EXISTS", "用户名已存在", 409);
    if (!normalized) throw codexError("CODEX_USER_INVALID", "用户名不能为空", 400);
    if (!['basic_user', 'developer', 'expert', 'admin'].includes(role)) throw codexError("CODEX_ROLE_INVALID", "角色无效", 400);
    const passwordHash = await hashPassword(password);
    // Recheck after asynchronous password hashing so concurrent requests return 409.
    if (this.repository.findUserByUsername(normalized)) throw codexError("CODEX_USER_EXISTS", "用户名已存在", 409);
    const record = this.repository.createUser({
      id: randomUUID(),
      username: normalized,
      displayName: displayName.trim() || normalized,
      role,
      passwordHash,
      enabled,
      createdAt: this.now().toISOString(),
    });
    return publicUser(record);
  }

  async login({ username, password }) {
    const user = this.repository.findUserByUsername(String(username || "").trim().toLowerCase());
    if (!user?.enabled || !(await verifyPassword(password, user.passwordHash))) {
      throw codexError("CODEX_LOGIN_FAILED", "用户名或密码错误", 401);
    }
    const token = randomBytes(32).toString("base64url");
    const tokenDigest = digest(token);
    const fingerprint = digest(`fingerprint:${token}`);
    const now = this.now();
    this.repository.saveSession({
      tokenDigest,
      userId: user.id,
      authFingerprint: fingerprint,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
    });
    return {
      user: publicUser(user),
      sessionId: token,
      bearerToken: token,
      cookie: `codex_pool_session=${token}; Path=/; HttpOnly; SameSite=Strict`,
    };
  }

  async authenticateSession(token, authType = "bearer") {
    const session = this.repository.findSession(digest(token));
    const user = session && this.repository.findUserById(session.user_id);
    if (!session || !user?.enabled || Date.parse(session.expires_at) <= this.now().getTime()) {
      if (session) this.repository.deleteSession(session.token_digest);
      throw codexError("CODEX_UNAUTHORIZED", "登录已失效", 401);
    }
    return { user: publicUser(user), authFingerprint: session.auth_fingerprint, authType };
  }

  async logout(token) { this.repository.deleteSession(digest(token)); }

  async changePassword(subject, { currentPassword, nextPassword }) {
    const user = this.repository.findUserById(subject.user.id);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw codexError("CODEX_PASSWORD_INVALID", "当前密码错误", 400);
    this.repository.updatePassword(user.id, await hashPassword(nextPassword));
  }

  me(subject) { return subject.user; }
  listUsers() { return this.repository.listUsers().map(publicUser); }

  signCodexCredentialProvenance(input) {
    const payload = { ...input, issuedAt: input.issuedAt || this.now().toISOString() };
    const signature = createHmac("sha256", this.provenanceSecret).update(JSON.stringify(payload)).digest("hex");
    return { ...payload, signature };
  }
}

function digest(value) { return createHash("sha256").update(String(value || "")).digest("hex"); }
function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, enabled: user.enabled };
}
