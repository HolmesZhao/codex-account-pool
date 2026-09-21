import test from "node:test";
import assert from "node:assert/strict";
import { CodexCredentialVault } from "../src/domain/codex-credential-vault.mjs";

test("credentials use account id and generation as authenticated data", () => {
  const vault = new CodexCredentialVault(Buffer.alloc(32, 7));
  const sealed = vault.encrypt({ access_token: "at", refresh_token: "rt" }, { accountId: "acct-1", generation: 3 });
  assert.deepEqual(vault.decrypt(sealed, { accountId: "acct-1", generation: 3 }), { access_token: "at", refresh_token: "rt" });
  assert.throws(() => vault.decrypt(sealed, { accountId: "acct-2", generation: 3 }));
});

test("credential payloads never serialize plaintext tokens", () => {
  const vault = new CodexCredentialVault(Buffer.alloc(32, 8));
  const sealed = vault.encrypt({ access_token: "very-secret-at", refresh_token: "very-secret-rt" }, { accountId: "acct-1", generation: 1 });
  assert.doesNotMatch(JSON.stringify(sealed), /very-secret/);
});

test("versioned data keys remain decryptable after restart", () => {
  const rootKey = Buffer.alloc(32, 11);
  const first = new CodexCredentialVault(rootKey);
  const sealed = first.encrypt({ token: "secret" }, { accountId: "acct-1", generation: 2, keyVersion: 3 });
  const restarted = new CodexCredentialVault(rootKey);
  assert.deepEqual(restarted.decrypt(sealed, { accountId: "acct-1", generation: 2, keyVersion: 3 }), { token: "secret" });
  assert.throws(() => restarted.decrypt(sealed, { accountId: "acct-1", generation: 2, keyVersion: 2 }));
});
