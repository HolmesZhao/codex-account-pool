import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import type { User } from "../lib/types";
import { routes } from "../app/routes";
import { Icon } from "./Icon";

interface AppShellProps { user: User; path: string; onNavigate: (path: string) => void; onLogout: () => void; children: ReactNode }

export function AppShell({ user, path, onNavigate, onLogout, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (menuOpen) document.querySelector<HTMLElement>(".mobile-nav a")?.focus(); }, [menuOpen]);
  const navigation = (className: string) => (
    <nav aria-label="主导航" className={className}>
      {routes.map((route) => (
        <a key={route.path} href={route.path} className={path === route.path ? "nav-link active" : "nav-link"} onClick={(event) => { event.preventDefault(); onNavigate(route.path); setMenuOpen(false); }}>
          <Icon icon={route.icon} /><span>{route.label}</span>
        </a>
      ))}
    </nav>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><span className="brand-mark">C</span><span>Codex 号池</span></a>
        {navigation("desktop-nav")}
        <div className="sidebar-note"><span className="health-dot" />服务运行正常</div>
      </aside>
      <div className="app-frame">
        <header className="topbar">
          <button ref={menuButton} className="icon-button mobile-menu-trigger" aria-label="打开导航" onClick={() => setMenuOpen(true)}><Menu /></button>
          <a className="mobile-brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}>Codex 号池</a>
          <div className="user-menu"><span className="avatar">{user.displayName.slice(0, 1)}</span><span className="user-name">{user.displayName}</span><ChevronDown size={15} /><button className="text-button" onClick={onLogout}>退出</button></div>
        </header>
        <main className="page-stage">{children}</main>
      </div>
      {menuOpen && <div className="mobile-nav-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setMenuOpen(false); menuButton.current?.focus(); } }}>
        <section className="mobile-nav-panel" aria-label="移动导航菜单">
          <div className="mobile-nav-head"><strong>Codex 号池</strong><button className="icon-button" aria-label="关闭导航" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }}><X /></button></div>
          {navigation("mobile-nav")}
        </section>
      </div>}
    </div>
  );
}
