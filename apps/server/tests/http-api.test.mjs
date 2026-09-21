import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodexPoolServer } from "../src/server.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "codex-pool-http-"));
  const app = await createCodexPoolServer({
    databaseUrl: join(directory, "pool.sqlite"),
    authDatabaseUrl: join(directory, "auth.sqlite"),
    credentialKey: Buffer.alloc(32, 5),
    admin: { username: "admin", password: "admin-pass-123" },
    maintenanceDisabled: true,
    runtime: { async close() {}, async readQuota() { return { primary: { usedPercent: 12 }, secondary: { usedPercent: 20 } }; } },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, url };
}

test("unauthenticated account list returns request id and 401", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/codex/accounts`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "CODEX_UNAUTHORIZED");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
});

test("fresh installation registers active credential key metadata without storing the key", async (t) => {
  const { app } = await fixture(t);
  const keys = await app.services.repository.listCredentialKeys();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].version, 1);
  assert.equal(keys[0].active, true);
  assert.match(keys[0].encryptedKey, /^external:[0-9a-f]{16}$/);
  assert.doesNotMatch(keys[0].encryptedKey, /0505050505/);
});

test("AT-only download disables cache and includes account headers", async (t) => {
  const { url } = await fixture(t);
  const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin-pass-123" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const imported = await fetch(`${url}/api/codex/accounts/import`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ auth: { email: "lin@example.com", auth_mode: "chatgpt", tokens: { access_token: "at-secret", refresh_token: "rt-secret", id_token: "id-secret" } } }) });
  const account = (await imported.json()).data;
  const ticketResponse = await fetch(`${url}/api/codex/accounts/${account.id}/download-ticket`, { method: "POST", headers: { cookie } });
  const ticket = (await ticketResponse.json()).data;
  const download = await fetch(`${url}${ticket.downloadUrl}`, { headers: { cookie } });
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("x-codex-account-id"), account.id);
  assert.equal(download.headers.get("x-codex-auth-generation"), "1");
  assert.equal((await download.json()).tokens.refresh_token, "");
});
