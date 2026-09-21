import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationFixture } from "./helpers/migration-fixture.mjs";
import { migrateCodexData } from "../../../scripts/migrate-from-asset-center.mjs";

test("missing credential key version rolls back the whole migration", async (t) => {
  const fixture = await createMigrationFixture({ revisionKeyVersion: 9, keyVersions: [8] });
  t.after(fixture.close);
  await assert.rejects(
    migrateCodexData({ source: fixture.source, target: fixture.target }),
    (error) => error.code === "CODEX_MIGRATION_KEY_VERSION_MISSING",
  );
  assert.deepEqual(fixture.target.listAccounts(), []);
  assert.deepEqual(fixture.target.listPools(), []);
});

test("migration preserves pool, account, revision and quota counts", async (t) => {
  const fixture = await createMigrationFixture({ revisionKeyVersion: 1, keyVersions: [1] });
  t.after(fixture.close);
  const report = await migrateCodexData({ source: fixture.source, target: fixture.target });
  assert.deepEqual(report.counts, { keys: 1, pools: 1, accounts: 1, revisions: 1, quotas: 1, activations: 0, audits: 1 });
  assert.deepEqual(report.digestMismatches, []);
  assert.deepEqual(fixture.target.getPoolAccountIds("pool-a"), ["acct-a"]);
});
