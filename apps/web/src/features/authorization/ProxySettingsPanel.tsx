import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type ProxySettings = { enabled: boolean; configured: boolean; address: string };
export function ProxySettingsPanel() {
  const [saved, setSaved] = useState<ProxySettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setError("");
    try {
      const value = await api.get<ProxySettings>("/api/codex/settings/proxy");
      setSaved(value); setEnabled(value.enabled);
    } catch (e) { setError(e instanceof Error ? e.message : "读取代理配置失败"); }
  }
  useEffect(() => { void load(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const value = await api.put<ProxySettings>("/api/codex/settings/proxy", { enabled, ...(url.trim() ? { url: url.trim() } : {}) });
      setSaved(value); setEnabled(value.enabled); setUrl("");
      setNotice("已保存，后续设备登录及额度刷新使用新配置；进行中的登录请取消后重新发起。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存代理配置失败"); }
    finally { setBusy(false); }
  }
  return <form className="proxy-settings-panel" onSubmit={save} aria-label="网络代理设置">
    <h2>网络代理（HTTP / SOCKS5）</h2>
    <p>用于服务端设备登录、额度刷新和自动维护。停用后直接连接。</p>
    <label className="proxy-toggle"><input type="checkbox" checked={enabled} disabled={!saved || busy} onChange={(e) => setEnabled(e.target.checked)} />启用代理</label>
    <label className="proxy-address">代理地址<input type="password" autoComplete="new-password" spellCheck={false} placeholder="http://192.168.1.10:7890" value={url} disabled={!saved || busy} onChange={(e) => setUrl(e.target.value)} /></label>
    <p>支持 http://主机:端口 或 socks5://主机:端口。SOCKS5 由代理解析目标域名。</p>
    <p>{saved?.configured ? `已保存：${saved.address}。地址留空则保留现有配置及认证信息。` : "两种协议均支持 用户名:密码@主机:端口；特殊字符需 URL 编码。"}</p>
    <p>群晖请填写代理设备的局域网 IP；127.0.0.1 指向容器自身。代理凭据加密保存，不回显。</p>
    {error && <div role="alert">{error}</div>}
    {notice && <div role="status">{notice}</div>}
    {!saved && error ? <button className="button" type="button" onClick={() => void load()}>重新加载代理配置</button> : <button className="button" type="submit" disabled={!saved || busy || (enabled && !saved.configured && !url.trim())}>{busy ? "正在保存…" : "保存代理设置"}</button>}
  </form>;
}
