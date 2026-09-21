import { copyFile, mkdir, readFile, rename, writeFile, chmod, access } from "node:fs/promises";
import { dirname } from "node:path";
import { requestPool } from "./http-client.mjs";

export async function switchAccount(config, accountId) {
  const ticket = await requestPool(config, `/api/codex/accounts/${encodeURIComponent(accountId)}/download-ticket`, { method: "POST" });
  const auth = await requestPool(config, ticket.downloadUrl, { raw: true });
  if (!auth?.tokens?.access_token || auth.tokens.refresh_token) throw Object.assign(new Error("服务端未返回合法 AT-only 凭证"), { code: "CODEX_POOL_AT_ONLY_REQUIRED" });
  await mkdir(dirname(config.authPath), { recursive: true });
  try { await access(config.authPath); await copyFile(config.authPath, `${config.authPath}.codex-pool-backup`); } catch {}
  await atomicWrite(config.authPath, auth);
  await atomicWrite(config.statePath, { managed: true, accountId, switchedAt: new Date().toISOString() });
  return { switched: true, accountId, generation: Number(ticket.generation || 0), restartRequired: true };
}

export async function restoreBackup(config) {
  await access(`${config.authPath}.codex-pool-backup`);
  await copyFile(`${config.authPath}.codex-pool-backup`, config.authPath);
  await chmod(config.authPath, 0o600);
  await atomicWrite(config.statePath, { managed: false, releasedAt: new Date().toISOString() });
  return { restored: true, restartRequired: true };
}

export async function readState(config) { try { return JSON.parse(await readFile(config.statePath, "utf8")); } catch { return { managed: false }; } }
async function atomicWrite(path, value) { const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600); }
