import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodexPoolServer } from "../src/server.mjs";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "codex-pool-http-"));
  const app = await createCodexPoolServer({
    databaseUrl: join(directory, "pool.sqlite"),
    authDatabaseUrl: join(directory, "auth.sqlite"),
    credentialKey: Buffer.alloc(32, 5),
    admin: { username: "admin", password: "admin-pass-123" },
    maintenanceDisabled: true,
    runtime: options.runtime || { async close() {}, async readQuota() { return { primary: { usedPercent: 12 }, secondary: { usedPercent: 20 } }; } },
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

test("administrator creates users, validates input and protects management APIs", async (t) => {
  const { url } = await fixture(t);
  async function login(username, password) {
    const res = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(res.status, 200);
    return res.headers.get("set-cookie").split(";")[0];
  }
  const adminCookie = await login("admin", "admin-pass-123");
  const request = (path, cookie, method = "GET", body) => fetch(url + path, { method, headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const userInput = { username: "MEMBER", displayName: "成员", password: "member-pass-123", role: "basic_user" };
  let res = await request("/api/codex/users", adminCookie, "POST", userInput);
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.data.username, "member");
  assert.equal(created.data.role, "basic_user");
  assert.doesNotMatch(JSON.stringify(created), /member-pass|passwordHash|scrypt/);
  assert.equal((await request("/api/codex/users", adminCookie, "POST", userInput)).status, 409);
  assert.equal((await request("/api/codex/users", adminCookie, "POST", { ...userInput, username: "short", password: "123" })).status, 400);
  assert.equal((await request("/api/codex/users", adminCookie, "POST", { ...userInput, username: "invalid", role: "owner" })).status, 400);
  const memberCookie = await login("member", "member-pass-123");
  assert.equal((await request("/api/codex/users", memberCookie, "POST", { ...userInput, username: "elevated", role: "admin" })).status, 403);
  for (const cookie of ["", memberCookie]) {
    const expected = cookie ? 403 : 401;
    assert.equal((await request("/api/codex/settings/proxy", cookie)).status, expected);
    assert.equal((await request("/api/codex/settings/proxy", cookie, "PUT", { enabled: true, url: "http://proxy.test:7890" })).status, expected);
  }
  res = await request("/api/codex/settings/proxy", adminCookie, "PUT", { enabled: true, url: "http://alice:secret@proxy.test:7890" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual((await res.json()).data, { enabled: true, configured: true, address: "http://proxy.test:7890" });
  assert.equal((await request("/api/codex/settings/proxy", adminCookie, "PUT", { enabled: true, url: "socks4://proxy.test:7890" })).status, 400);
  res = await request("/api/codex/settings/proxy", adminCookie, "PUT", { enabled: true, url: "socks5://alice:secret@proxy.test:1080" });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { enabled: true, configured: true, address: "socks5://proxy.test:1080" });
  assert.equal((await request("/api/codex/settings/proxy", adminCookie, "PUT", { enabled: false })).status, 200);
});


test("renewal APIs persist rotations, preserve AT-only downloads and require management rights", async t=>{
  let refreshes=0;
  const runtime={async close(){},async inspect(input,{refresh}){const auth=JSON.parse(input);if(refresh){refreshes++;auth.tokens.refresh_token=`rt-${refreshes}`;}return {updatedAuthJson:JSON.stringify(auth),refreshed:refresh,quota:{primary:{usedPercent:5}}};}};
  const {url,app}=await fixture(t,{runtime});
  const login=await fetch(url+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"admin-pass-123"})});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const request=(path,method="GET",body)=>fetch(url+path,{method,headers:{cookie,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const imported=await request("/api/codex/accounts/import","POST",{auth:{email:"renew@example.test",tokens:{access_token:"safe-test-at",refresh_token:"original-rt"}}});
  const account=(await imported.json()).data;
  assert.equal(account.generation,2);assert.equal(account.maintenance.refreshStatus,"healthy");
  await request(`/api/codex/accounts/${account.id}/quota`,"POST");assert.equal(refreshes,1);
  const rotated=await request(`/api/codex/accounts/${account.id}/credential-rotate`,"POST");
  assert.equal(rotated.status,200);assert.equal(refreshes,2);
  assert.doesNotMatch(JSON.stringify(await rotated.json()),/rt-2|safe-test-at/);
  const ticket=(await (await request(`/api/codex/accounts/${account.id}/download-ticket`,"POST")).json()).data;
  assert.equal((await (await request(ticket.downloadUrl)).json()).tokens.refresh_token,"");
  await app.services.authService.createUser({username:"member",password:"member-pass-123"});
  const member=await app.services.authService.login({username:"member",password:"member-pass-123"});
  const forbidden=await fetch(url+`/api/codex/accounts/${account.id}/credential-rotate`,{method:"POST",headers:{authorization:`Bearer ${member.bearerToken}`}});
  assert.equal(forbidden.status,403);
});
