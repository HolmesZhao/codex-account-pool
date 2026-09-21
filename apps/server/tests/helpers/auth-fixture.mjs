import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AuthRepository } from "../../src/auth/auth-repository.mjs";
import { AuthService } from "../../src/auth/auth-service.mjs";
import { createAuthContext } from "../../src/auth/auth-context.mjs";
import { PermissionService } from "../../src/auth/permission-service.mjs";

export async function createAuthFixture(seed) {
  const directory = await mkdtemp(join(tmpdir(), "codex-pool-auth-"));
  const repository = new AuthRepository({ filename: join(directory, "auth.sqlite") });
  const auth = new AuthService({ repository, sessionTtlMs: 60_000, provenanceSecret: "fixture-provenance-secret-32-bytes" });
  const user = await auth.createUser({ ...seed, displayName: seed.username });
  const permissions = new PermissionService();
  return {
    repository,
    auth,
    permissions,
    user,
    context: (request) => createAuthContext(request, auth),
    close: async () => {
      repository.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function requestWithCookie(token) {
  return { headers: { cookie: `codex_pool_session=${token}` } };
}

export function requestWithBearer(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}
