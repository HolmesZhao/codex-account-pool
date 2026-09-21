import { useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw, Search } from "lucide-react";
import { api } from "../../lib/api";
import type { Account, Pool } from "../../lib/types";
import { AccountTable } from "./AccountTable";
import { AccountDetailDrawer } from "./AccountDetailDrawer";
import { ImportAccountDialog } from "./ImportAccountDialog";

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]); const [pools, setPools] = useState<Pool[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Account | null>(null); const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null); const [importing, setImporting] = useState(false); const [refreshingId, setRefreshingId] = useState(""); const [query, setQuery] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { Promise.all([api.get<Account[]>("/api/codex/accounts"), api.get<Pool[]>("/api/codex/pools")]).then(([nextAccounts, nextPools]) => { setAccounts(nextAccounts); setPools(nextPools); }).finally(() => setLoading(false)); }, []);
  const filtered = useMemo(() => accounts.filter((account) => `${account.email} ${account.alias}`.toLowerCase().includes(query.toLowerCase())), [accounts, query]);
  async function refresh(account: Account) { setRefreshingId(account.id); setNotice(""); try { const usage = await api.post<Account["usage"]>(`/api/codex/accounts/${account.id}/quota`); setAccounts((items) => items.map((item) => item.id === account.id ? { ...item, usage } : item)); if (usage?.stale) setNotice(usage.error ? `额度刷新失败：${usage.error}` : "额度数据已过期，正在显示上次成功数据"); } catch { setNotice("暂时无法刷新，正在显示上次成功数据"); } finally { setRefreshingId(""); } }
  async function download(account: Account) { const ticket = await api.post<{ downloadUrl: string }>(`/api/codex/accounts/${account.id}/download-ticket`); window.location.assign(ticket.downloadUrl); }
  return <section className="page accounts-page"><header className="page-header"><div><h1>账号运行状态</h1><p>集中查看凭证、额度与轮换状态。</p></div><div className="header-actions"><button className="button" onClick={() => Promise.all(accounts.map(refresh))}><RefreshCw size={16} />刷新全部额度</button><button className="button primary" onClick={() => setImporting(true)}><Plus size={16} />导入账号</button></div></header>
    <div className="summary-band"><Summary label="账号总数" value={accounts.length} /><Summary label="可用账号" value={accounts.filter((item) => item.status === "ready" && item.enabled).length} tone="success" /><Summary label="需要处理" value={accounts.filter((item) => item.status !== "ready").length} tone="warning" /><Summary label="额度更新时间" value={latestCollectedAt(accounts)} compact /></div>
    <div className="table-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索账号" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱或别名" /></label><span>{filtered.length} 个账号</span></div>
    {notice && <div className="notice warning" role="status">{notice}</div>}
    {loading ? <div className="table-loading">正在读取账号…</div> : <AccountTable accounts={filtered} pools={pools} refreshingId={refreshingId} onRefresh={refresh} onOpen={(account, trigger) => { setSelected(account); setReturnFocus(trigger); }} />}
    {selected && <AccountDetailDrawer account={accounts.find((account) => account.id === selected.id) || selected} pools={pools} returnFocus={returnFocus} onClose={() => setSelected(null)} onRefresh={() => refresh(selected)} onDownload={() => download(selected)} onCheck={() => api.post(`/api/codex/accounts/${selected.id}/check-credential`)} onSave={async (patch) => { const updated = await api.put<Account>(`/api/codex/accounts/${selected.id}`, patch); setAccounts((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); setSelected(updated); }} onDelete={async () => { if (window.confirm(`确认删除 ${selected.email}？`)) { await api.delete(`/api/codex/accounts/${selected.id}`); setAccounts((items) => items.filter((item) => item.id !== selected.id)); setSelected(null); } }} />}
    {importing && <ImportAccountDialog onClose={() => setImporting(false)} onImported={(account) => { setAccounts((items) => [account, ...items.filter((item) => item.id !== account.id)]); setImporting(false); setNotice("账号导入成功"); }} />}
  </section>;
}
function Summary({ label, value, tone, compact }: { label: string; value: string | number; tone?: string; compact?: boolean }) { return <div className="summary-item"><span>{label}</span><strong className={`${tone || ""} ${compact ? "compact" : ""}`}>{value}</strong></div>; }
function latestCollectedAt(accounts: Account[]) { const dates = accounts.map((item) => item.usage?.collectedAt).filter(Boolean).sort(); if (!dates.length) return "尚未刷新"; return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(dates.at(-1)!)); }
