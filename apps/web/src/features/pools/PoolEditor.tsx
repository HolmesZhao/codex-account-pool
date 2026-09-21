import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import type { Account, Pool, PoolSubject } from "../../lib/types";

interface Props { pool: Pool; accounts: Account[]; onSave: (pool: Pool) => Promise<void>; onDelete: (pool: Pool) => Promise<void>; onClose?: () => void }
export function PoolEditor({ pool, accounts, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(pool); const [subject, setSubject] = useState("");
  useEffect(() => setDraft(pool), [pool]);
  const toggleAccount = (id: string) => setDraft((value) => ({ ...value, accountIds: value.accountIds.includes(id) ? value.accountIds.filter((item) => item !== id) : [...value.accountIds, id] }));
  const addSubject = () => { const id = subject.trim(); if (!id) return; const next: PoolSubject = { type: ["basic_user", "developer", "expert", "admin"].includes(id) ? "role" : "user", id }; setDraft((value) => ({ ...value, subjects: [...value.subjects.filter((item) => !(item.type === next.type && item.id === next.id)), next] })); setSubject(""); };
  return <section className="pool-editor"><header><div><span>编辑号池</span><h2>{pool.name}</h2></div>{onClose && <button className="icon-button" aria-label="关闭号池编辑" onClick={onClose}><X /></button>}</header><div className="pool-editor-body"><label className="field">号池名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field">说明<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <fieldset><legend>池内账号</legend><p>选择该号池可调度的 Codex 账号。</p><div className="selection-list">{accounts.map((account) => <label key={account.id} className="selection-row"><span className="account-avatar">{account.email[0].toUpperCase()}</span><span><strong>{account.email}</strong><small>{account.alias || "未设置别名"}</small></span><input type="checkbox" checked={draft.accountIds.includes(account.id)} onChange={() => toggleAccount(account.id)} /></label>)}</div></fieldset>
    <fieldset><legend>授权对象</legend><p>用户和角色命中任意一项即可访问号池。</p><div className="subject-add"><input aria-label="添加用户或角色" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="用户名或角色名" /><button className="button" onClick={addSubject}><Plus size={14} />添加</button></div><div className="subject-list">{draft.subjects.map((item) => <span key={`${item.type}:${item.id}`}><small>{item.type === "role" ? "角色" : "用户"}</small>{item.id}<button aria-label={`移除 ${item.id}`} onClick={() => setDraft((value) => ({ ...value, subjects: value.subjects.filter((entry) => entry !== item) }))}><X size={13} /></button></span>)}</div></fieldset>
  </div><footer><button className="button danger ghost" onClick={() => onDelete(pool)}><Trash2 size={15} />删除号池</button><button className="button primary" onClick={() => onSave(draft)}><Check size={15} />保存更改</button></footer></section>;
}
