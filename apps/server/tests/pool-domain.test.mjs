import test from "node:test";
import assert from "node:assert/strict";
import { createDomainFixture } from "./helpers/domain-fixture.mjs";

test("member only sees accounts inside granted pools", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  await fixture.pools.save(fixture.admin, { id: "pool-a", name: "核心研发池", accountIds: ["acct-a"], subjects: [{ type: "user", id: fixture.member.user.id }] });
  const accounts = await fixture.accounts.list(fixture.member);
  assert.deepEqual(accounts.map((item) => item.id), ["acct-a"]);
});

test("administrator sees all accounts", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  assert.deepEqual((await fixture.accounts.list(fixture.admin)).map((item) => item.id), ["acct-a", "acct-b"]);
});
