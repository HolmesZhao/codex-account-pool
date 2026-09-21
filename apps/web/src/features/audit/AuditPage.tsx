import { useEffect, useState } from "react";
import { Filter, Search } from "lucide-react";
import { api } from "../../lib/api";
import type { AuditEvent } from "../../lib/types";
import { formatDate } from "../accounts/account-format";

const actionLabels: Record<string, string> = { "account.import": "导入账号", "account.reauth": "重新登录", "account.update": "更新账号", "account.delete": "删除账号", "credential_key.rotate": "轮换凭证密钥", "pool.create": "创建号池", "pool.update": "更新号池", "pool.delete": "删除号池" };
export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]); const [query, setQuery] = useState("");
  useEffect(() => { api.get<AuditEvent[]>("/api/codex/audit").then(setEvents); }, []);
  const visible = events.filter((event) => `${event.actorId} ${event.targetId} ${event.action}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="page audit-page"><header className="page-header"><div><h1>操作审计</h1><p>追踪账号、号池和凭证敏感操作。</p></div><button className="button"><Filter size={16} />筛选</button></header><div className="table-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索审计" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主体、动作或目标" /></label><span>{visible.length} 条记录</span></div><div className="table-frame"><table className="data-table audit-table"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>目标</th><th>结果</th></tr></thead><tbody>{visible.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{event.actorId}</td><td><strong>{actionLabels[event.action] || event.action}</strong></td><td>{event.targetId || "—"}</td><td><span className={`status-text ${event.result === "success" ? "success" : "danger"}`}><i />{event.result === "success" ? "成功" : "失败"}</span></td></tr>)}</tbody></table>{!visible.length && <div className="table-empty">没有匹配的审计记录。</div>}</div></section>;
}
