import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { User } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { AccountsPage } from "../features/accounts/AccountsPage";
import { PoolsPage } from "../features/pools/PoolsPage";
import { AuthorizationPage } from "../features/authorization/AuthorizationPage";
import { AuditPage } from "../features/audit/AuditPage";
import { OverviewPage } from "../features/overview/OverviewPage";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  useEffect(() => { api.get<User>("/api/auth/me").then(setUser).catch(() => setUser(null)); }, []);
  useEffect(() => { const listener = () => setPath(normalizePath(window.location.pathname)); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  const navigate = (next: string) => { window.history.pushState({}, "", next); setPath(next); };
  if (user === undefined) return <div className="app-loading" aria-label="正在载入"><span /></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <AppShell user={user} path={path} onNavigate={navigate} onLogout={async () => { await api.post("/api/auth/logout"); setUser(null); }}>{renderRoute(path, navigate)}</AppShell>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try { const result = await api.post<{ user: User }>("/api/auth/login", { username: data.get("username"), password: data.get("password") }); onLogin(result.user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-panel"><div className="login-brand"><span className="brand-mark">C</span><span>Codex 号池</span></div><h1>登录 Codex 号池</h1><p>管理账号凭证、额度与授权范围。</p><form onSubmit={submit}><label>用户名<input name="username" autoComplete="username" required autoFocus /></label><label>密码<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary wide" disabled={busy}>{busy ? "正在登录…" : "登录"}</button></form></section></main>;
}

function renderRoute(path: string, navigate: (path: string) => void) { if (path === "/accounts") return <AccountsPage />; if (path === "/pools") return <PoolsPage />; if (path === "/authorization") return <AuthorizationPage />; if (path === "/audit") return <AuditPage />; return <OverviewPage onNavigate={navigate} />; }
function normalizePath(path: string) { return ["/", "/accounts", "/pools", "/authorization", "/audit"].includes(path) ? path : "/"; }
