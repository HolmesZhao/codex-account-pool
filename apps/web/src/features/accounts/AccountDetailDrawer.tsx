import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, KeyRound, RefreshCw, Trash2, X } from "lucide-react";
import type { Account, Pool, QuotaWindow } from "../../lib/types";
import { credentialLabel, formatDate, planLabel, statusTone } from "./account-format";

interface Props { account: Account; pools: Pool[]; returnFocus?: HTMLElement | null; onClose: () => void; onRefresh: () => void; onDownload: () => void; onCheck: () => Promise<void>; onSave: (patch: Pick<Account, "alias" | "enabled">) => Promise<void>; onDelete: () => void }
export function AccountDetailDrawer({ account, pools, returnFocus, onClose, onRefresh, onDownload, onCheck, onSave, onDelete }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [alias, setAlias] = useState(account.alias);
  const [enabled, setEnabled] = useState(account.enabled);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const fiveHour = quotaWindow(account, "fiveHour");
  const weekly = quotaWindow(account, "weekly");
  useEffect(() => { panel.current?.focus(); return () => returnFocus?.focus(); }, [returnFocus]);
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={panel} tabIndex={-1} className="account-drawer" role="dialog" aria-modal="true" aria-label={`${account.email} 账号详情`}>
      <header className="drawer-head"><div><span className="drawer-kicker">账号详情</span><h2>{account.email}</h2><p>{account.alias || "未设置别名"}</p></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X /></button></header>
      <div className="drawer-body">
        <DetailSection title="登录与凭证"><div className="detail-grid"><Info label="账户类型" value={planLabel(account.usage?.planType)} /><Info label="凭证模式" value={credentialLabel(account.credentialMode, account.status)} tone={statusTone(account.status)} /><Info label="凭证代次" value={`Generation ${account.generation}`} /><Info label="账号状态" value={account.enabled ? "已启用" : "已停用"} /><Info label="最近更新" value={formatDate(account.updatedAt)} /></div><div className="inline-actions"><button className="button" onClick={onDownload}><Download size={15} />下载 AT-only</button><button className="button" onClick={async () => { setNotice(""); try { await onCheck(); setNotice("凭证解密与摘要检查通过"); } catch { setNotice("凭证检查失败，请重新登录"); } }}><KeyRound size={15} />检查凭证</button><button className="button" onClick={onRefresh}><RefreshCw size={15} />刷新额度</button></div>{notice && <p className="notice" role="status">{notice}</p>}</DetailSection>
        <DetailSection title="额度"><div className="drawer-quota">{fiveHour && <QuotaDetail label="5 小时" window={fiveHour} />}{weekly && <QuotaDetail label="每周" window={weekly} />}{!fiveHour && !weekly && <span className="cell-muted">暂无额度窗口</span>}</div>{account.usage?.stale && <p className="notice warning">额度数据已过期，当前显示最后一次成功结果。</p>}</DetailSection>
        <DetailSection title="使用情况"><div className="detail-grid"><Info label="最近采集" value={formatDate(account.usage?.collectedAt)} /><Info label="当前号池" value={pools.find((pool) => pool.accountIds.includes(account.id))?.name || "未分配"} /></div></DetailSection>
        <DetailSection title="账号设置"><label className="field">账号别名<input value={alias} onChange={(event) => setAlias(event.target.value)} /></label><label className="toggle-row"><span><strong>启用账号</strong><small>停用后用户无法选择或下载该账号。</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label></DetailSection>
      </div>
      <footer className="drawer-footer"><button className="button danger ghost" onClick={onDelete}><Trash2 size={15} />删除账号</button><button className="button primary" disabled={saving} onClick={async () => { setSaving(true); try { await onSave({ alias, enabled }); setNotice("账号设置已保存"); } finally { setSaving(false); } }}>{saving ? "正在保存…" : "保存更改"}</button></footer>
    </section>
  </div>;
}
function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section>; }
function Info({ label, value, tone }: { label: string; value: string; tone?: string }) { return <div className="info-pair"><span>{label}</span><strong className={tone}>{value}</strong></div>; }
function quotaWindow(account: Account, key: "fiveHour" | "weekly") { const usage = account.usage; if (!usage) return null; if (key in usage) return usage[key] || null; return key === "fiveHour" ? usage.primary || null : usage.secondary || null; }
function QuotaDetail({ label, window }: { label: string; window: QuotaWindow }) { const remaining = Math.round(window.remainingPercent ?? (100 - window.usedPercent)); return <div><div className="quota-detail-head"><span>{label}</span><strong>{remaining}% 可用</strong></div><span className="quota-track large"><i style={{ width: `${remaining}%` }} /></span><small>{Math.round(window.usedPercent)}% 已用 · {formatDate(window.resetsAt)} 重置</small></div>; }
