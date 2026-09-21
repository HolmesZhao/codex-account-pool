#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadHelperConfig } from "./lib/helper-config.mjs";
import { requestPool } from "./lib/http-client.mjs";
import { login } from "./lib/login-credentials.mjs";
import { readState, restoreBackup, switchAccount } from "./lib/switcher.mjs";
import { safeDiagnostic } from "./lib/diagnostics.mjs";

export async function runHelper(argv, io = { env: process.env, stdout: process.stdout, stderr: process.stderr }) {
  const args = argv.filter((arg) => arg !== "--json"); const command = args[0] || "status";
  try {
    const config = await loadHelperConfig(io.env);
    if (command === "login") return login(config, io.env);
    if (command === "accounts") return { accounts: await requestPool(config, "/api/codex/accounts") };
    if (command === "quota") return { accountId: required(args[1]), quota: await requestPool(config, `/api/codex/accounts/${encodeURIComponent(args[1])}/quota`) };
    if (command === "switch" || command === "refresh") return switchAccount(config, required(args[1]));
    if (command === "rollback" || command === "release") return restoreBackup(config);
    if (command === "status") return { ...(await readState(config)), authPath: config.authPath, serverUrl: config.serverUrl };
    if (command === "coordinate") { const state = await readState(config); return state.managed && state.accountId ? switchAccount(config, state.accountId) : { coordinated: false, reason: "not-managed" }; }
    if (command === "hook") {
      try { const state = await readState(config); if (state.managed && state.accountId) await switchAccount(config, state.accountId); else await requestPool(config, "/api/codex/accounts", { timeoutMs: 2_500 }); return { continue: true, coordinated: Boolean(state.managed) }; }
      catch (error) { return { continue: true, coordinated: false, diagnostic: safeDiagnostic(error) }; }
    }
    throw Object.assign(new Error(`未知命令: ${command}`), { code: "CODEX_POOL_COMMAND_UNKNOWN" });
  } catch (error) {
    if (command === "hook") return { continue: true, coordinated: false, diagnostic: safeDiagnostic(error) };
    throw error;
  }
}

function required(value) { if (!value) throw Object.assign(new Error("缺少账号 ID"), { code: "CODEX_POOL_ACCOUNT_REQUIRED" }); return value; }
async function main() { try { const result = await runHelper(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(result)}\n`); } catch (error) { process.stderr.write(`${JSON.stringify({ error: { code: error.code || "CODEX_POOL_HELPER_FAILED", message: safeDiagnostic(error) } })}\n`); process.exitCode = 1; } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
