import { createRepositoryFixture } from "./repository-fixture.mjs";

export async function createMigrationFixture({ revisionKeyVersion, keyVersions }) {
  const sourceFixture = await createRepositoryFixture();
  const targetFixture = await createRepositoryFixture();
  const source = sourceFixture.repository;
  source.savePool({ id: "pool-a", name: "核心研发池", enabled: true });
  source.saveAccount({ id: "acct-a", email: "a@example.com", enabled: true, status: "ready", generation: 0 });
  source.setPoolAccounts("pool-a", ["acct-a"]);
  source.setPoolSubjects("pool-a", [{ type: "role", id: "developer" }]);
  for (const version of keyVersions) source.saveCredentialKey({ version, encryptedKey: `key-${version}`, active: version === keyVersions.at(-1) });
  source.commitRevision({ accountId: "acct-a", expectedGeneration: 0, revision: { encrypted: "sealed", sha256: "literal-sha", keyVersion: revisionKeyVersion, mode: "legacy" } });
  source.saveQuotaSnapshot({ id: "quota-a", accountId: "acct-a", payload: { primary: { usedPercent: 25 } }, collectedAt: "2026-09-21T01:00:00.000Z", stale: false });
  source.appendAudit({ id: "audit-a", actorId: "admin", action: "account.import", targetType: "account", targetId: "acct-a", result: "success" });
  return {
    source,
    target: targetFixture.repository,
    close: async () => { await sourceFixture.close(); await targetFixture.close(); },
  };
}
