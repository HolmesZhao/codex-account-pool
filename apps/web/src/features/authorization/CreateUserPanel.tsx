import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { User } from "../../lib/types";

export function CreateUserPanel({ onCreated }: { onCreated: (user: User) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const user = await api.post<User>("/api/codex/users", Object.fromEntries(data));
      onCreated(user); form.reset(); setOpen(false);
      setNotice(`用户 ${user.username} 已创建，可使用设置的密码登录。请在号池页面配置访问授权。`);
    } catch (e) { setError(e instanceof Error ? e.message : "创建用户失败"); }
    finally { setBusy(false); }
  }
  return <div className="create-user-panel">
    <button className="button primary" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setError(""); }} disabled={busy}>{open ? "取消创建" : "创建用户"}</button>
    {notice && <div className="notice" role="status">{notice}</div>}
    {open && <form className="admin-user-form" onSubmit={submit} aria-label="创建用户">
      <label>用户名<input name="username" required maxLength={100} pattern="[^\s]+" autoComplete="off" autoFocus /></label>
      <label>显示名称<input name="displayName" maxLength={100} /></label>
      <label>初始密码<input name="password" type="password" required minLength={10} maxLength={1024} autoComplete="new-password" /></label>
      <label>角色<select name="role" defaultValue="basic_user"><option value="basic_user">普通用户</option><option value="developer">开发者</option><option value="expert">专家</option><option value="admin">管理员</option></select></label>
      <p>密码至少 10 个字符。管理员拥有全部管理权限，其他角色的号池访问范围由号池授权决定。</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="button primary" disabled={busy}>{busy ? "正在创建…" : "确认创建"}</button>
    </form>}
  </div>;
}
