import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCodexRepository } from "../src/storage/codex-account-repository.mjs";
import { CodexCredentialVault } from "../src/domain/codex-credential-vault.mjs";
import { CredentialRenewal, hash, withCredentialLease } from "../src/domain/credential-renewal.mjs";

const start = Date.parse("2026-09-22T00:00:00Z");
function auth({ rt = "rt-1", exp = start / 1000 + 10 * 86400, iat = start / 1000, identity = "upstream-account" } = {}) {
  const claims = { exp, iat, iss: "issuer", aud: "codex", sub: "subject", "https://api.openai.com/auth": { chatgpt_account_id: identity } };
  return { tokens: { access_token: `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`, refresh_token: rt, account_id: identity } };
}
async function fixture(t, initial = auth()) {
  const dir = await mkdtemp(join(tmpdir(), "renewal-test-"));
  const path = join(dir, "db.sqlite");
  const repository = await createCodexRepository({ databaseUrl: path });
  const vault = new CodexCredentialVault(Buffer.alloc(32, 7));
  let clock = start, calls = [];
  const runtime = { async inspect(input, options) { calls.push(options); const current = JSON.parse(input); if (options.refresh) current.tokens.refresh_token += "-rotated"; return { updatedAuthJson: JSON.stringify(current), quota: { primary: { usedPercent: 12 } }, refreshed: options.refresh }; } };
  await repository.saveCredentialKey({ version: 1, encryptedKey: "external", active: true });
  await repository.saveAccount({ id: "a", email: "a@example.test", status: "ready" });
  await repository.commitRevision({ accountId: "a", expectedGeneration: 0, revision: { encrypted: JSON.stringify(vault.encrypt(initial, { accountId: "a", generation: 1 })), sha256: hash(JSON.stringify(initial)), keyVersion: 1, mode: "legacy" } });
  const service = new CredentialRenewal({ repository, vault, runtime, now: () => new Date(clock) });
  t.after(async () => { await service.close(); await repository.close(); await rm(dir, { recursive: true, force: true }); });
  return { path, repository, vault, runtime, service, calls, time: (value) => { clock = value; }, now: () => new Date(clock) };
}
test("existing credentials cut over, persist encrypted rotation, and rotate at 71–72h but quota-only does not force it", async t => {
  const f = await fixture(t);
  const first = await f.service.run("a");
  assert.equal(first.generation, 2); assert.equal(first.maintenance.refreshStatus, "healthy");
  const due = Date.parse(first.maintenance.nextRotationAt);
  assert.ok(due >= start + 71 * 3600_000 && due < start + 72 * 3600_000);
  f.time(due - 1); await f.service.run("a"); assert.equal(f.calls.at(-1).refresh, false);
  f.time(due); await f.service.run("a", { quotaOnly: true }); assert.equal(f.calls.at(-1).refresh, false);
  assert.equal((await f.repository.getAccount("a")).generation, 2);
  const second = await f.service.run("a"); assert.equal(second.generation, 3);
  const repo2 = await createCodexRepository({ databaseUrl: f.path });
  try { assert.equal((await repo2.getMaintenance("a")).nextRotationAt, second.maintenance.nextRotationAt); } finally { await repo2.close(); }
  const revision = await f.repository.getRevision("a"); assert.doesNotMatch(revision.encrypted, /rt-1|rotated/);
  assert.equal(f.service.decode("a", revision).tokens.refresh_token, "rt-1-rotated-rotated");
});
test("AT expiry inside 30 minutes triggers early rotation", async t => {
  const f = await fixture(t, auth({ exp: start / 1000 + 3600 })); await f.service.run("a");
  f.time(start + 31 * 60_000); await f.service.run("a"); assert.equal(f.calls.at(-1).refresh, true);
});
test("new credentials survive quota failure, and transient failures back off 5/15/60 minutes", async t => {
  const f = await fixture(t);
  f.runtime.inspect = async input => { const value = JSON.parse(input); value.tokens.refresh_token = "new-chain"; return { updatedAuthJson: JSON.stringify(value), refreshed: true, error: { message: "quota connection failed" } }; };
  let result = await f.service.run("a");
  assert.equal(result.generation, 2); assert.equal(f.service.decode("a", await f.repository.getRevision("a")).tokens.refresh_token, "new-chain");
  assert.equal(Date.parse(result.maintenance.nextRetryAt), start + 5 * 60_000);
  f.runtime.inspect = async input => ({ updatedAuthJson: input, error: { message: "network timeout" } });
  f.time(start + 5 * 60_000); result = await f.service.run("a"); assert.equal(Date.parse(result.maintenance.nextRetryAt), start + 20 * 60_000);
  f.time(start + 20 * 60_000); result = await f.service.run("a"); assert.equal(Date.parse(result.maintenance.nextRetryAt), start + 80 * 60_000);
});
test("invalid RT with >48h AT retains a recovery window; otherwise requires reauth", async t => {
  const f = await fixture(t);
  f.runtime.inspect = async input => ({ updatedAuthJson: input, error: { message: "invalid_grant" } });
  let result = await f.service.run("a"); assert.equal(result.maintenance.refreshStatus, "awaiting_client_reconcile");
  const deadline = Date.parse(result.maintenance.nextRetryAt); assert.equal(deadline, start + 8 * 86400_000);
  result = await f.service.run("a", { quotaOnly: true }); assert.equal(result.maintenance.refreshStatus, "awaiting_client_reconcile");
  f.time(deadline); result = await f.service.run("a"); assert.equal(result.maintenance.refreshStatus, "needs_reauth");
});
test("AT-only and disabled accounts never explicitly refresh RT", async t => {
  const f = await fixture(t, auth({ rt: "" }));
  assert.equal((await f.service.run("a")).maintenance.refreshStatus, "manual"); assert.equal(f.calls[0].refresh, false);
  await f.repository.saveAccount({ ...await f.repository.getAccount("a"), enabled: false });
  await f.service.run("a"); assert.equal(f.calls.at(-1).refresh, false);
});
test("concurrent requests join; another instance is excluded and expired leases are fenced", async t => {
  const f = await fixture(t); const original = f.runtime.inspect;
  f.runtime.inspect = async (...args) => { await new Promise(resolve => setTimeout(resolve, 20)); return original(...args); };
  const [a,b] = await Promise.all([f.service.run("a"), f.service.run("a")]); assert.equal(a.generation,b.generation); assert.equal(f.calls.length,1);
  const second = await createCodexRepository({ databaseUrl:f.path });
  try {
    await withCredentialLease(f.repository,"a",async owner => {
      const other = new CredentialRenewal({repository:second,vault:f.vault,runtime:f.runtime,now:f.now});
      await assert.rejects(other.run("a"),{code:"CODEX_CREDENTIAL_BUSY"});
      f.time(start+301_000);
      assert.equal(await second.acquireCredentialLease("a","new-owner",new Date(start+600_000).toISOString(),f.now().toISOString()),true);
      const revision=await f.repository.getRevision("a");
      assert.throws(()=>f.repository.commitRevision({accountId:"a",expectedGeneration:revision.generation,revision,leaseOwner:owner,now:f.now().toISOString()}),{code:"CODEX_CREDENTIAL_LEASE_LOST"});
    },f.now);
  } finally {await second.close();}
});
test("reconcile preserves server chain; only permanent failure adopts a newer same-identity RT", async t => {
  const f=await fixture(t);
  let result=await f.service.reconcile("a",auth({rt:"local-rt",iat:start/1000+10})); assert.equal(result.source,"server");
  const original=f.runtime.inspect;
  f.runtime.inspect=async (input,options)=> JSON.parse(input).tokens.refresh_token.startsWith("rt-1") ? {updatedAuthJson:input,error:{message:"invalid_grant"}} : original(input,options);
  result=await f.service.reconcile("a",auth({rt:"local-rt",iat:start/1000+10})); assert.equal(result.source,"local");
  assert.equal(f.service.decode("a",await f.repository.getRevision("a")).tokens.refresh_token,"local-rt-rotated");
});
test("reconcile rejects foreign identity and never adopts local RT on transient upstream failure", async t => {
  const f=await fixture(t);
  await assert.rejects(f.service.reconcile("a",auth({identity:"foreign"})),{code:"CODEX_RECONCILE_IDENTITY"});
  f.runtime.inspect=async input=>({updatedAuthJson:input,error:{message:"network timeout"}});
  await assert.rejects(f.service.reconcile("a",auth({rt:"local-rt",iat:start/1000+10})),{code:"CODEX_RECONCILE_RETRY"});
  assert.equal((await f.repository.getAccount("a")).generation,1);
});
test("opening an older database adds maintenance storage without losing credentials", async t => {
  const f=await fixture(t);
  const db=new DatabaseSync(f.path); db.exec("DROP TABLE codex_maintenance; DROP TABLE codex_credential_leases");db.close();
  const upgraded=await createCodexRepository({databaseUrl:f.path});
  try {assert.equal((await upgraded.getRevision("a")).generation,1);assert.equal(await upgraded.getMaintenance("a"),null);}finally{await upgraded.close();}
});

test("quota-only credential changes are persisted, but a different account is quarantined",async t=>{
 const f=await fixture(t);
 f.runtime.inspect=async input=>{const updated=JSON.parse(input);updated.tokens.refresh_token='quota-rotated-rt';return {updatedAuthJson:JSON.stringify(updated),quota:{}};};
 await f.service.run('a',{quotaOnly:true});assert.equal((await f.repository.getRevision('a')).generation,2);
 f.runtime.inspect=async()=>({updatedAuthJson:JSON.stringify(auth({identity:'other'})),quota:{}});
 const result=await f.service.run('a',{quotaOnly:true});assert.equal(result.maintenance.refreshStatus,'quarantined');assert.equal((await f.repository.getRevision('a')).generation,2);
});


test("reconcile rejects a spoofed account_id inconsistent with JWT account claims",async t=>{
 const f=await fixture(t);const local=auth({identity:'other',rt:'local'});local.tokens.account_id='upstream-account';
 await assert.rejects(f.service.reconcile('a',local),{code:'CODEX_RECONCILE_IDENTITY'});
 assert.equal(f.calls.length,0);
});
