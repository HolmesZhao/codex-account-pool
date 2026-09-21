import { ROLE_ACTIONS, codexError } from "../common/contracts.mjs";

export class PermissionService {
  async require(subject, action) {
    if (!subject?.user?.enabled) throw codexError("CODEX_FORBIDDEN", "账号已停用", 403);
    if (!ROLE_ACTIONS[subject.user.role]?.includes(action)) throw codexError("CODEX_FORBIDDEN", "无权执行此操作", 403);
    return true;
  }

  async can(subject, action) {
    try { await this.require(subject, action); return true; } catch { return false; }
  }
}
