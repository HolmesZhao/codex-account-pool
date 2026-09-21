import test from "node:test";
import assert from "node:assert/strict";
import { MaintenanceScheduler } from "../src/domain/maintenance-scheduler.mjs";

test("maintenance respects configured concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const scheduler = new MaintenanceScheduler({
    listAccountIds: async () => ["a", "b", "c", "d"],
    maintain: async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; },
    concurrency: 2,
  });
  await scheduler.runOnce();
  assert.equal(maximum, 2);
});
