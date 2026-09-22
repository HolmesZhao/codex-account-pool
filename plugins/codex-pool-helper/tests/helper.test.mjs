import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHelperFixture, managedAtOnlyAuth, originalAuth } from "./helper-fixture.mjs";

test("switch atomically writes AT-only auth and keeps a backup", async (t) => {
  const fixture = await createHelperFixture({ localAuth: originalAuth, downloadedAuth: managedAtOnlyAuth });
  t.after(fixture.close);
  await fixture.run(["switch", "acct-a"]);
  const written = JSON.parse(await readFile(fixture.authPath, "utf8"));
  assert.equal(written.tokens.access_token, "managed-at");
  assert.equal(written.tokens.refresh_token, "");
  assert.equal(await fixture.backupExists(), true);
});

test("hook network failure preserves auth and always continues", async (t) => {
  const fixture = await createHelperFixture({ localAuth: originalAuth, networkError: true });
  t.after(fixture.close);
  const result = await fixture.run(["hook"]);
  assert.deepEqual(JSON.parse(await readFile(fixture.authPath, "utf8")), originalAuth);
  assert.equal(result.continue, true);
  assert.doesNotMatch(result.diagnostic, /local-at|local-rt/);
});


test("managed hook reconciles local RT before replacing it and never backs up RT", async t => {
  const f=await createHelperFixture({localAuth:originalAuth});t.after(f.close);
  await f.run(["switch","acct-a"]);
  await writeFile(f.authPath,JSON.stringify(originalAuth));
  f.requests.length=0;
  const result=await f.run(["hook"]);
  assert.equal(result.coordinated,true);
  assert.equal(f.requests[0],"/api/codex/accounts/acct-a/credential-reconcile");
  assert.equal(JSON.parse(await readFile(f.authPath,"utf8")).tokens.refresh_token,"");
  assert.equal(JSON.parse(await readFile(f.authPath+".codex-pool-backup","utf8")).tokens.refresh_token,"");
});
test("failed reconciliation leaves the local RT unchanged and the hook continues", async t => {
  const f=await createHelperFixture({localAuth:originalAuth,reconcileError:true});t.after(f.close);
  await f.run(["switch","acct-a"]);await writeFile(f.authPath,JSON.stringify(originalAuth));f.requests.length=0;
  const result=await f.run(["hook"]);
  assert.equal(result.continue,true);assert.equal(result.coordinated,false);
  assert.deepEqual(JSON.parse(await readFile(f.authPath,"utf8")),originalAuth);
  assert.deepEqual(f.requests,["/api/codex/accounts/acct-a/credential-reconcile"]);
});
