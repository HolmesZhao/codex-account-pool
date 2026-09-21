import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, ExternalLink, FileJson, Radio, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Account } from "../../lib/types";

type DeviceFlow = { id: string; status: string; userCode: string; verificationUrl: string; expiresAt?: string; account?: Account };

export function ImportAccountDialog({ onClose, onImported }: { onClose: () => void; onImported: (account: Account) => void }) {
  const [mode, setMode] = useState<"file" | "device">("file");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deviceFlow || deviceFlow.status !== "pending") return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await api.post<DeviceFlow>(`/api/codex/login-flows/${deviceFlow.id}/poll`);
        if (stopped) return;
        setDeviceFlow(next);
        if (next.status === "complete" && next.account) onImported(next.account);
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Device Code 登录失败");
      }
    };
    const timer = window.setInterval(poll, 1_500);
    poll();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [deviceFlow?.id, deviceFlow?.status, onImported]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "file") {
        const selected = file.current?.files?.[0];
        if (!selected) throw new Error("请选择 auth.json 文件");
        onImported(await api.post<Account>("/api/codex/accounts/import", { auth: JSON.parse(await selected.text()) }));
      } else {
        setDeviceFlow(await api.post<DeviceFlow>("/api/codex/login-flows", { mode: "import" }));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setBusy(false); }
  }

  async function close() {
    if (deviceFlow?.status === "pending") await api.post(`/api/codex/login-flows/${deviceFlow.id}/cancel`).catch(() => null);
    onClose();
  }

  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="导入账号">
    <header><div><h2>导入账号</h2><p>导入 auth.json，或通过 Device Code 登录。</p></div><button className="icon-button" aria-label="关闭导入" onClick={close}><X /></button></header>
    <div className="segment"><button className={mode === "file" ? "active" : ""} onClick={() => { setMode("file"); setDeviceFlow(null); }}><FileJson size={16} />auth.json</button><button className={mode === "device" ? "active" : ""} onClick={() => setMode("device")}><Radio size={16} />Device Code</button></div>
    <form onSubmit={submit}>
      {mode === "file" ? <label className="file-drop">auth.json 文件<input ref={file} type="file" accept="application/json,.json" /><span>选择本机 Codex 凭证文件</span></label> : deviceFlow ? <div className="device-challenge"><span>在授权页面输入以下验证码</span><strong>{deviceFlow.userCode}</strong><div className="inline-actions"><button type="button" className="button" onClick={() => navigator.clipboard.writeText(deviceFlow.userCode)}><Copy size={15} />复制验证码</button><a className="button primary" href={deviceFlow.verificationUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />打开授权页面</a></div><small>完成授权后，本页会自动导入账号。</small></div> : <div className="device-explain"><strong>安全连接 Codex</strong><p>继续后会生成一次性 Device Code，并在完成授权后自动导入账号。</p></div>}
      {error && <p className="form-error">{error}</p>}
      <footer><button type="button" className="button" onClick={close}>取消</button>{(!deviceFlow || mode === "file") && <button className="button primary" disabled={busy}>{busy ? "正在启动…" : mode === "device" ? "生成 Device Code" : "确认导入"}</button>}</footer>
    </form>
  </section></div>;
}
