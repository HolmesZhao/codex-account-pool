import { ChevronRight, RefreshCw } from "lucide-react";
import type { Account, Pool, QuotaWindow } from "../../lib/types";
import { credentialLabel, formatDate, planLabel, statusTone } from "./account-format";

interface Props { accounts: Account[]; pools: Pool[]; onOpen: (account: Account, trigger: HTMLButtonElement) => void; onRefresh: (account: Account) => void; refreshingId?: string }
export function AccountTable({ accounts, pools, onOpen, onRefresh, refreshingId }: Props) {
  const poolFor = (id: string) => pools.find((pool) => pool.accountIds.includes(id))?.name || "未分配";
  return <div className="table-frame"><table className="account-table"><thead><tr><th>账号</th><th>账户类型</th><th>号池</th><th>凭证状态</th><th>5 小时额度</th><th>每周额度</th><th>下次轮换</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>
    {accounts.map((account) => { const fiveHour = windowFor(account, "fiveHour"); const weekly = windowFor(account, "weekly"); return <tr key={account.id}>
      <td data-label="账号"><div className="account-identity"><span className="account-avatar">{account.email.slice(0, 1).toUpperCase()}</span><div><strong>{account.email}</strong><span>{account.alias || "未设置别名"}</span></div></div></td>
      <td data-label="账户类型"><span className="pool-name">{planLabel(account.usage?.planType)}</span></td>
      <td data-label="号池"><span className="pool-name">{poolFor(account.id)}</span></td>
      <td data-label="凭证状态"><span className={`status-text ${statusTone(account.status)}`}><i />{credentialLabel(account.credentialMode, account.status)}</span></td>
      <td data-label="5 小时额度"><Quota window={fiveHour} /></td>
      <td data-label="每周额度"><Quota window={weekly} /></td>
      <td data-label="下次轮换"><span className="cell-primary">{account.status === "ready" ? formatDate(fiveHour?.resetsAt || weekly?.resetsAt) : "等待处理"}</span></td>
      <td className="row-actions"><button className="row-icon" aria-label={`刷新 ${account.email} 额度`} disabled={refreshingId === account.id} onClick={() => onRefresh(account)}><RefreshCw className={refreshingId === account.id ? "spin" : ""} size={16} /></button><button className="row-icon" aria-label={`查看 ${account.email}`} onClick={(event) => onOpen(account, event.currentTarget)}><ChevronRight size={18} /></button></td>
    </tr>; })}
  </tbody></table>{accounts.length === 0 && <div className="table-empty">还没有账号，导入后会显示在这里。</div>}</div>;
}
function windowFor(account: Account, key: "fiveHour" | "weekly") { const usage = account.usage; if (!usage) return null; if (key in usage) return usage[key] || null; return key === "fiveHour" ? usage.primary || null : usage.secondary || null; }
function Quota({ window }: { window: QuotaWindow | null }) { if (!window) return <span className="cell-muted">不适用</span>; const remaining = Math.round(window.remainingPercent ?? (100 - window.usedPercent)); return <div className="quota-cell"><div><span>{remaining}%</span><small>{Math.round(window.usedPercent)}% 已用</small></div><span className="quota-track"><i style={{ width: `${remaining}%` }} className={remaining <= 15 ? "danger" : remaining <= 35 ? "warning" : ""} /></span></div>; }
