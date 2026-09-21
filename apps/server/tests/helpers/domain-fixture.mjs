import { createRepositoryFixture } from "./repository-fixture.mjs";
import { PermissionService } from "../../src/auth/permission-service.mjs";
import { CodexCredentialVault } from "../../src/domain/codex-credential-vault.mjs";
import { PoolService } from "../../src/domain/pool-service.mjs";
import { AccountService } from "../../src/domain/account-service.mjs";
import { CredentialService } from "../../src/domain/credential-service.mjs";
import { QuotaService } from "../../src/domain/quota-service.mjs";
import { LoginFlowService } from "../../src/domain/login-flow-service.mjs";

export async function createDomainFixture() {
  const base = await createRepositoryFixture();
  const repository = base.repository;
  repository.saveCredentialKey({ version: 1, encryptedKey: "external:test", active: true });
  repository.saveAccount({ id: "acct-a", email: "a@example.com", enabled: true, status: "ready", generation: 0 });
  repository.saveAccount({ id: "acct-b", email: "b@example.com", enabled: true, status: "ready", generation: 0 });
  const permissionService = new PermissionService();
  const vault = new CodexCredentialVault(Buffer.alloc(32, 9));
  for (const id of ["acct-a", "acct-b"]) {
    const auth = { auth_mode: "chatgpt", tokens: { access_token: `${id}-at`, refresh_token: `${id}-rt`, id_token: `${id}-id` } };
    repository.commitRevision({ accountId: id, expectedGeneration: 0, revision: { encrypted: JSON.stringify(vault.encrypt(auth, { accountId: id, generation: 1 })), sha256: `${id}-sha`, keyVersion: 1, mode: "legacy" } });
  }
  const admin = subject("admin-id", "admin", "admin");
  const member = subject("member-id", "member", "basic_user");
  const runtime = {
    async beginLogin() { return { deviceCode: "device-code", userCode: "ABCD-EFGH", verificationUri: "https://example.test/device" }; },
    async pollLogin() { return { auth: { auth_mode: "chatgpt", tokens: { access_token: "device-at", refresh_token: "device-rt", id_token: "device-id" } }, email: "device@example.com" }; },
    async readQuota() { return { primary: { usedPercent: 12 }, secondary: { usedPercent: 35 } }; },
    async close() {},
  };
  const pools = new PoolService({ repository, permissionService });
  const accounts = new AccountService({ repository, permissionService, vault });
  const credentials = new CredentialService({ repository, permissionService, vault, ticketTtlMs: 60_000 });
  const quota = new QuotaService({ repository, permissionService, runtime, vault });
  const loginFlows = new LoginFlowService({ repository, permissionService, runtime, accountService: accounts });
  return { ...base, repository, pools, accounts, credentials, quota, loginFlows, admin, member, runtime };
}

function subject(id, username, role) {
  return { user: { id, username, displayName: username, role, enabled: true }, authFingerprint: `${id}-fp`, authType: "bearer" };
}
