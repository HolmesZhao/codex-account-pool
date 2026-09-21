import test from "node:test";
import assert from "node:assert/strict";

import { CODEX_ACTIONS, ROLE_ACTIONS, codexError } from "../src/common/contracts.mjs";

test("basic_user only receives non-administrative pool actions", () => {
  assert.deepEqual(ROLE_ACTIONS.basic_user, [
    "codex_account:read",
    "codex_account:use",
    "codex_account:import",
    "codex_account:reauth",
    "codex_quota:read",
  ]);
  assert.equal(CODEX_ACTIONS.includes("codex_account:raw_export"), true);
  assert.equal(ROLE_ACTIONS.basic_user.includes("codex_pool:manage"), false);
});

test("codexError creates a stable public error", () => {
  const error = codexError("CODEX_FORBIDDEN", "无权操作", 403);
  assert.deepEqual(
    { code: error.code, message: error.message, status: error.status },
    { code: "CODEX_FORBIDDEN", message: "无权操作", status: 403 },
  );
});
