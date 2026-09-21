import test from "node:test";
import assert from "node:assert/strict";
import { createDomainFixture } from "./helpers/domain-fixture.mjs";

test("device login flow advances from pending to complete", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  const flow = await fixture.loginFlows.start(fixture.admin, { mode: "import" });
  assert.equal(flow.status, "pending");
  const completed = await fixture.loginFlows.poll(fixture.admin, flow.id);
  assert.equal(completed.status, "complete");
  assert.equal(completed.account.email, "device@example.com");
});

test("cancelled flow cannot be polled", async (t) => {
  const fixture = await createDomainFixture();
  t.after(fixture.close);
  const flow = await fixture.loginFlows.start(fixture.admin, { mode: "import" });
  await fixture.loginFlows.cancel(fixture.admin, flow.id);
  await assert.rejects(fixture.loginFlows.poll(fixture.admin, flow.id), (error) => error.code === "CODEX_LOGIN_FLOW_CANCELLED");
});
