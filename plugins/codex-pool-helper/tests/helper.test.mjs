import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
