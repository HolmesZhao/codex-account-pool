import http from "node:http";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHelper } from "../scripts/codex-pool-helper.mjs";

export const originalAuth = { auth_mode: "chatgpt", tokens: { access_token: "local-at", refresh_token: "local-rt", id_token: "local-id" } };
export const managedAtOnlyAuth = { auth_mode: "chatgpt", tokens: { access_token: "managed-at", refresh_token: "", id_token: "managed-id" } };

export async function createHelperFixture({ localAuth, downloadedAuth = managedAtOnlyAuth, networkError = false, reconcileError = false }) {
  const directory = await mkdtemp(join(tmpdir(), "codex-pool-helper-"));
  const codexHome = join(directory, "codex"); await mkdir(codexHome, { recursive: true });
  const authPath = join(codexHome, "auth.json"); await writeFile(authPath, `${JSON.stringify(localAuth)}\n`, { mode: 0o600 });
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url?.endsWith("/credential-reconcile") && reconcileError) { response.writeHead(503, {"content-type":"application/json"}); response.end(JSON.stringify({error:{code:"CODEX_RECONCILE_RETRY",message:"retry later"}})); return; }
    if (networkError) { request.socket.destroy(); return; }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/codex/accounts") response.end(JSON.stringify({ data: [{ id: "acct-a", email: "a@example.com", status: "ready", generation: 2 }] }));
    else if (request.url === "/api/codex/accounts/acct-a/download-ticket") response.end(JSON.stringify({ data: { downloadUrl: "/api/codex/download-tickets/ticket-a" } }));
    else if (request.url === "/api/codex/download-tickets/ticket-a") response.end(JSON.stringify(downloadedAuth));
    else response.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { CODEX_HOME: codexHome, CODEX_POOL_SERVER_URL: `http://127.0.0.1:${server.address().port}`, CODEX_POOL_TOKEN: "fixture-token" };
  return {
    authPath, requests,
    run: (args) => runHelper(args, { env, stdout: { write() {} }, stderr: { write() {} } }),
    backupExists: async () => access(`${authPath}.codex-pool-backup`).then(() => true, () => false),
    close: async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); },
  };
}
