import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryFixture } from "./helpers/repository-fixture.mjs";
import { createCodexRepository } from "../src/storage/codex-account-repository.mjs";

test("repository persists pools, accounts, grants, revisions and audit", async (t) => {
  const fixture = await createRepositoryFixture();
  t.after(fixture.close);
  const { repository } = fixture;
  repository.savePool({ id: "pool-a", name: "核心研发池", description: "核心账号", enabled: true });
  repository.saveAccount({ id: "acct-a", email: "lin@example.com", alias: "主账号", enabled: true, status: "ready", generation: 0 });
  repository.setPoolAccounts("pool-a", ["acct-a"]);
  repository.setPoolSubjects("pool-a", [{ type: "user", id: "user-a" }]);
  const revision = repository.commitRevision({ accountId: "acct-a", expectedGeneration: 0, revision: { encrypted: "sealed", sha256: "abc", keyVersion: 1, mode: "legacy" } });
  repository.appendAudit({ actorId: "user-a", action: "account.import", targetType: "account", targetId: "acct-a", result: "success" });
  assert.equal(revision.generation, 1);
  assert.deepEqual(repository.listAccessibleAccountIds({ userId: "user-a", roles: [] }), ["acct-a"]);
  assert.equal(repository.listAudits({}).length, 1);
});

test("ticket consumption is atomic and mode bound", async (t) => {
  const fixture = await createRepositoryFixture();
  t.after(fixture.close);
  const { repository } = fixture;
  repository.saveTicket({ digest: "ticket-1", userId: "user-a", fingerprint: "fp", accountId: "acct-a", generation: 2, mode: "at-only", expiresAt: "2026-09-21T03:00:00.000Z" });
  const first = repository.consumeTicket({ digest: "ticket-1", userId: "user-a", fingerprint: "fp", mode: "at-only", now: "2026-09-21T02:00:00.000Z" });
  const second = repository.consumeTicket({ digest: "ticket-1", userId: "user-a", fingerprint: "fp", mode: "at-only", now: "2026-09-21T02:00:00.000Z" });
  assert.equal(first.accountId, "acct-a");
  assert.equal(second, null);
});

test("PostgreSQL adapter preserves the core repository contract", { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const schema = `codex_pool_test_${Date.now()}`;
  const repository = await createCodexRepository({ databaseUrl: process.env.TEST_POSTGRES_URL, postgresSchema: schema });
  try {
    const pool = await repository.savePool({ name: "PostgreSQL 测试池", enabled: true });
    const account = await repository.saveAccount({ email: `${Date.now()}@example.test`, enabled: true, status: "ready" });
    await repository.setPoolAccounts(pool.id, [account.id]);
    await repository.setPoolSubjects(pool.id, [{ type: "role", id: "developer" }]);
    const revision = await repository.commitRevision({ accountId: account.id, expectedGeneration: 0, revision: { encrypted: "sealed", sha256: "sha", keyVersion: 1, mode: "legacy" } });
    assert.equal(revision.generation, 1);
    const now = new Date(), expires = new Date(now.getTime()+300_000).toISOString();
    assert.equal(await repository.acquireCredentialLease(account.id,"owner-a",expires,now.toISOString()),true);
    assert.equal(await repository.acquireCredentialLease(account.id,"owner-b",expires,now.toISOString()),false);
    await repository.saveMaintenance(account.id,{refreshStatus:"healthy"},{owner:"owner-a",generation:1,now:now.toISOString()});
    const next = await repository.commitRevision({accountId:account.id,expectedGeneration:1,revision:{encrypted:"sealed-2",sha256:"sha2",keyVersion:1,mode:"managed"},leaseOwner:"owner-a",maintenance:{refreshStatus:"healthy",nextRotationAt:expires}});
    assert.equal(next.generation,2);
    assert.equal((await repository.getMaintenance(account.id)).nextRotationAt,expires);
    await assert.rejects(repository.commitRevision({accountId:account.id,expectedGeneration:1,revision:{encrypted:"stale",sha256:"sha",keyVersion:1}}),{code:"CODEX_AUTH_REVISION_CONFLICT"});
    await repository.releaseCredentialLease(account.id,"owner-a");
    assert.deepEqual(await repository.listAccessibleAccountIds({ userId: "nobody", roles: ["developer"] }), [account.id]);
  } finally {
    await repository.rawPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await repository.close();
  }
});
