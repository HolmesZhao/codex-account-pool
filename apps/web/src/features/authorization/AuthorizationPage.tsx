import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { CreateUserPanel } from "./CreateUserPanel";
import { ProxySettingsPanel } from "./ProxySettingsPanel";
import { api } from "../../lib/api";
import type { Pool, User } from "../../lib/types";

const roleLabels: Record<string, string> = { basic_user: "普通用户", developer: "开发者", expert: "专家", admin: "管理员" };
type CredentialKey = { version: number; active: boolean };

export function AuthorizationPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [keys, setKeys] = useState<CredentialKey[]>([]);
  const [query, setQuery] = useState("");
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    Promise.all([api.get<User[]>("/api/codex/users"), api.get<Pool[]>("/api/codex/pools"), api.get<CredentialKey[]>("/api/codex/credential-keys")])
      .then(([nextUsers, nextPools, nextKeys]) => { setUsers(nextUsers); setPools(nextPools); setKeys(nextKeys); }).catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);
  const visible = users.filter((user) => `${user.username} ${user.displayName}`.toLowerCase().includes(query.toLowerCase()));
  async function rotateKey() {
    if (!window.confirm("轮换密钥会事务性重加密全部账号的当前凭证。确认继续？")) return;
    setRotating(true); setNotice("");
    try {
      const result = await api.post<{ version: number; rotatedAccounts: number }>("/api/codex/credential-keys/rotate");
      setKeys(await api.get<CredentialKey[]>("/api/codex/credential-keys"));
      setNotice(`已切换到 v${result.version}，重加密 ${result.rotatedAccounts} 个账号`);
    } catch (e) { setError(e instanceof Error ? e.message : "轮换失败"); } finally { setRotating(false); }
  }
  return <section className="page authorization-page">
    <header className="page-header"><div><h1>用户授权</h1><p>维护用户角色与号池使用权限。</p></div><button className="button" onClick={() => window.alert("普通角色可读取、使用、导入、重新登录与读取额度；管理员拥有全部管理权限。号池授权请在号池编辑区维护。") }><ShieldCheck size={16} />权限说明</button></header>
    <div className="security-band"><div><KeyRound size={18} /><span><strong>凭证密钥</strong><small>{keys.find((key) => key.active) ? `当前版本 v${keys.find((key) => key.active)?.version}` : "正在读取密钥版本"}</small></span></div><button className="button" disabled={rotating} onClick={rotateKey}><RefreshCw size={15} />{rotating ? "正在轮换…" : "轮换密钥"}</button></div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <ProxySettingsPanel />
    {error && <div role="alert" className="form-error">{error}</div>}
    <CreateUserPanel onCreated={(user) => setUsers((current) => [...current, user].sort((a, b) => a.username.localeCompare(b.username)))} />
    <div className="table-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索用户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名或姓名" /></label><span>{visible.length} 位用户</span></div>
    <div className="table-frame"><table className="data-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>可访问号池</th><th>权限范围</th></tr></thead><tbody>{visible.map((user) => <tr key={user.id}><td><div className="account-identity"><span className="account-avatar">{user.displayName[0]}</span><div><strong>{user.username}</strong><span>{user.displayName}</span></div></div></td><td><span className="role-label">{roleLabels[user.role]}</span></td><td><span className={`status-text ${user.enabled ? "success" : "warning"}`}><i />{user.enabled ? "已启用" : "已停用"}</span></td><td>{user.role === "admin" ? "全部号池" : pools.filter((pool) => pool.subjects.some((subject) => subject.id === user.id || subject.id === user.role)).map((pool) => pool.name).join("、") || "无"}</td><td>{user.role === "admin" ? "全部管理权限" : "读取、使用、导入、额度"}</td></tr>)}</tbody></table></div>
  </section>;
}
