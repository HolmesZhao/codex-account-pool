import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAccountUsageSnapshot, publicAccountUsage } from "../src/domain/codex-quota-window.mjs";

test("quota refresh failure keeps last successful values and marks stale", () => {
  const previous = { primary: { usedPercent: 42 }, secondary: { usedPercent: 18 }, collectedAt: "2026-09-21T01:00:00.000Z" };
  const result = normalizeAccountUsageSnapshot(null, { previous, now: new Date("2026-09-21T02:00:00.000Z"), error: "upstream timeout" });
  assert.equal(result.primary.usedPercent, 42);
  assert.equal(result.stale, true);
  assert.equal(result.needsReauth, false);
});

test("explicit authentication failures require reauth", () => {
  const result = publicAccountUsage(null, { error: "401 unauthorized", now: new Date("2026-09-21T02:00:00.000Z") });
  assert.equal(result.needsReauth, true);
});

test("classifies a Pro weekly-only window by duration and exposes remaining quota", () => {
  const result = normalizeAccountUsageSnapshot({
    primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1790325608 },
    secondary: null,
    planType: "pro",
  }, { now: new Date("2026-09-21T02:00:00.000Z") });
  assert.equal(result.planType, "pro");
  assert.equal(result.fiveHour, null);
  assert.equal(result.weekly.usedPercent, 100);
  assert.equal(result.weekly.remainingPercent, 0);
  assert.equal(result.weekly.windowDurationMins, 10080);
});
