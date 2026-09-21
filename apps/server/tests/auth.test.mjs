import test from "node:test";
import assert from "node:assert/strict";

import { createAuthFixture, requestWithBearer, requestWithCookie } from "./helpers/auth-fixture.mjs";

test("login creates an HttpOnly session and member cannot manage pools", async (t) => {
  const fixture = await createAuthFixture({ username: "lin", password: "safe-pass-123", role: "basic_user" });
  t.after(fixture.close);
  const login = await fixture.auth.login({ username: "lin", password: "safe-pass-123" });
  assert.match(login.cookie, /HttpOnly/);
  const subject = await fixture.auth.authenticateSession(login.sessionId, "cookie");
  await assert.rejects(
    fixture.permissions.require(subject, "codex_pool:manage"),
    (error) => error.code === "CODEX_FORBIDDEN" && error.status === 403,
  );
});

test("Bearer and Cookie resolve to the same stable user id", async (t) => {
  const fixture = await createAuthFixture({ username: "admin", password: "safe-pass-123", role: "admin" });
  t.after(fixture.close);
  const login = await fixture.auth.login({ username: "admin", password: "safe-pass-123" });
  const cookieSubject = await fixture.context(requestWithCookie(login.sessionId));
  const bearerSubject = await fixture.context(requestWithBearer(login.bearerToken));
  assert.equal(cookieSubject.user.id, bearerSubject.user.id);
  await fixture.permissions.require(cookieSubject, "codex_pool:manage");
});

test("disabled and expired sessions are rejected", async (t) => {
  const fixture = await createAuthFixture({ username: "mei", password: "safe-pass-123", role: "developer" });
  t.after(fixture.close);
  const login = await fixture.auth.login({ username: "mei", password: "safe-pass-123" });
  fixture.repository.setUserEnabled(fixture.user.id, false);
  await assert.rejects(fixture.auth.authenticateSession(login.sessionId), (error) => error.code === "CODEX_UNAUTHORIZED");
});
