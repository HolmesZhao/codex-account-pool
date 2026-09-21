import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function loadHelperConfig(env = process.env) {
  const codexHome = env.CODEX_HOME || join(env.HOME || process.cwd(), ".codex");
  const configPath = join(codexHome, "codex-pool-helper.json");
  let saved = {};
  try { saved = JSON.parse(await readFile(configPath, "utf8")); } catch {}
  const serverUrl = String(env.CODEX_POOL_SERVER_URL || saved.serverUrl || "").replace(/\/$/, "");
  if (!serverUrl) throw Object.assign(new Error("请先设置 CODEX_POOL_SERVER_URL"), { code: "CODEX_POOL_SERVER_REQUIRED" });
  return { codexHome, authPath: saved.authPath || join(codexHome, "auth.json"), statePath: join(codexHome, "codex-pool-helper-state.json"), configPath, serverUrl, token: env.CODEX_POOL_TOKEN || saved.token || "" };
}
export async function saveHelperConfig(config, patch) { await mkdir(dirname(config.configPath), { recursive: true }); await writeFile(config.configPath, `${JSON.stringify({ serverUrl: config.serverUrl, authPath: config.authPath, ...patch }, null, 2)}\n`, { mode: 0o600 }); }
