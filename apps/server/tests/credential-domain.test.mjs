import test from "node:test";
import assert from "node:assert/strict";
import { createDomainFixture } from "./helpers/domain-fixture.mjs";

test("damaged auth.json is rejected without reflecting token material", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  const secret = "sk-sensitive-token";
  await assert.rejects(
    fixture.accounts.importAuth(fixture.admin, `{\"tokens\":\"${secret}`),
    (error) => error.code === "CODEX_AUTH_JSON_INVALID" && !error.message.includes(secret),
  );
});

test("concurrent consumption of one AT-only ticket has one winner", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  await fixture.pools.save(fixture.admin, { id: "pool-a", name: "核心研发池", accountIds: ["acct-a"], subjects: [{ type: "user", id: fixture.member.user.id }] });
  const ticket = await fixture.credentials.issueDownloadTicket(fixture.member, "acct-a", "at-only");
  const results = await Promise.allSettled([
    fixture.credentials.consumeDownloadTicket(fixture.member, ticket.token, "at-only"),
    fixture.credentials.consumeDownloadTicket(fixture.member, ticket.token, "at-only"),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  const auth = results.find((item) => item.status === "fulfilled").value.auth;
  assert.equal(auth.tokens.refresh_token, "");
  assert.equal(auth.tokens.access_token, "acct-a-at");
});

test("credential inspection decrypts the current revision without returning secrets", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  const result = await fixture.credentials.inspect(fixture.admin, "acct-a");
  assert.deepEqual(result, { valid: true, generation: 1, mode: "legacy", sha256: "acct-a-sha" });
  assert.doesNotMatch(JSON.stringify(result), /acct-a-(?:at|rt|id)/);
});

test("key rotation re-encrypts current revisions and preserves downloads", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  await fixture.pools.save(fixture.admin, { id: "pool-a", name: "核心研发池", accountIds: ["acct-a"], subjects: [{ type: "user", id: fixture.member.user.id }] });
  const rotated = await fixture.credentials.rotateKey(fixture.admin);
  assert.deepEqual(rotated, { version: 2, active: true, rotatedAccounts: 2 });
  assert.equal((await fixture.repository.getRevision("acct-a")).keyVersion, 2);
  const ticket = await fixture.credentials.issueDownloadTicket(fixture.member, "acct-a", "at-only");
  const downloaded = await fixture.credentials.consumeDownloadTicket(fixture.member, ticket.token, "at-only");
  assert.equal(downloaded.auth.tokens.access_token, "acct-a-at");
  assert.equal(downloaded.auth.tokens.refresh_token, "");
});
