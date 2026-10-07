import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Account } from "../../lib/types";

type KeyItem = { id: string; label: string; accountId: string; maskedKey: string; enabled: boolean; createdAt: string };
export function OpenApiSettingsPanel({ accounts }: { accounts: Account[] }) {
  const [items, setItems] = useState<KeyItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [accountId, setAccountId] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() { setError(""); try { setItems(await api.get<KeyItem[]>("/api/codex/settings/openapi-keys")); setLoaded(true); } catch (e) { setError(e instanceof Error ? e.message : "读取 API Key 失败"); } }
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setCreatedKey("");
    try {
      const result = await api.post<KeyItem & { apiKey: string }>("/api/codex/settings/openapi-keys", { label, accountId });
      const { apiKey, ...item } = result;
      setItems(current => [...current, item]); setCreatedKey(apiKey); setLabel(""); setNotice("已创建。完整 API Key 只显示这一次，请复制保存。");
    } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); } finally { setBusy(false); }
  }
  async function change(item: KeyItem, revoke = false) {
    if (revoke && !window.confirm(`撤销 ${item.label}？该 Key 将立即失效。`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (revoke) { await api.delete(`/api/codex/settings/openapi-keys/${item.id}`); setItems(current => current.filter(value => value.id !== item.id)); setCreatedKey(""); }
      else { const value = await api.put<KeyItem>(`/api/codex/settings/openapi-keys/${item.id}`, { enabled: !item.enabled }); setItems(current => current.map(existing => existing.id === item.id ? value : existing)); }
      setNotice(revoke ? "API Key 已撤销" : "启用状态已更新");
    } catch (e) { setError(e instanceof Error ? e.message : "更新失败"); } finally { setBusy(false); }
  }
  return <section className="proxy-settings-panel" aria-label="OpenAPI 访问设置">
    <h2>OpenAPI · API Key</h2><p>每个 Key 固定绑定一个账号，可为多台电脑分别创建。停用或撤销后立即失效。</p>
    <form onSubmit={create} className="admin-user-form">
      <label>Key 名称<input value={label} maxLength={100} required disabled={busy || !loaded} onChange={event => setLabel(event.target.value)} placeholder="例如：MacBook 工作账号" /></label>
      <label>绑定账号<select value={accountId} required disabled={busy || !loaded} onChange={event => setAccountId(event.target.value)}><option value="">请选择账号</option>{accounts.filter(account => account.enabled).map(account => <option key={account.id} value={account.id}>{account.email}{account.alias ? ` · ${account.alias}` : ""}</option>)}</select></label>
      <button className="button" disabled={busy || !loaded || !accountId || !label.trim()}>生成 API Key</button>
    </form>
    {createdKey && <div className="notice"><label>新 API Key（仅显示一次）<input readOnly value={createdKey} spellCheck={false} onFocus={event => event.target.select()} /></label><div className="inline-actions"><button className="button" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(createdKey); setNotice("API Key 已复制"); } catch { setError("复制失败，请选中输入框手动复制"); } }}>复制 Key</button><button className="button" onClick={() => setCreatedKey("")}>隐藏</button></div></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!loaded && error && <button className="button" onClick={() => void load()}>重新加载 API Key</button>}
    <div className="openapi-key-list">{items.map(item => <div key={item.id} className="openapi-key-row"><div><strong>{item.label}</strong><small>{accounts.find(account => account.id === item.accountId)?.email || "绑定账号已删除"} · {item.maskedKey} · {item.enabled ? "已启用" : "已停用"}</small></div><div className="inline-actions"><button className="button" disabled={busy} onClick={() => void change(item)}>{item.enabled ? "停用" : "启用"}</button><button className="button danger" disabled={busy} onClick={() => void change(item, true)}>撤销</button></div></div>)}</div>
    {loaded && items.length === 0 && <p>尚未创建 API Key。</p>}
    <p>请求 <code>GET /api/openapi/account</code>，请求头使用 <code>X-API-Key</code>。返回当前 AT、有效期及剩余额度；不会返回 RT。</p>
  </section>;
}
