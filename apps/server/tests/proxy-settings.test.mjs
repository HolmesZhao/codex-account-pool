import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthRepository } from "../src/auth/auth-repository.mjs";
import { CodexCredentialVault } from "../src/domain/codex-credential-vault.mjs";
import { ProxySettings } from "../src/domain/proxy-settings.mjs";

test("proxy survives restart, encrypts credentials, preserves credentials on toggle and clears inherited bypasses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxy-settings-test-"));
  const filename = join(dir, "auth.sqlite");
  let repository = new AuthRepository({ filename });
  const vault = new CodexCredentialVault(Buffer.alloc(32, 8));
  try {
    let settings = new ProxySettings({ repository, vault });
    assert.deepEqual(settings.publicState(), { enabled: false, configured: false, address: "" });
    for (const url of ["socks4://host:7890", "socks5://host/path", "https://host", "http://host/path", "http://host?query", "http://host#fragment", "bad"]) assert.throws(() => settings.save({ enabled: true, url }), { code: "CODEX_PROXY_INVALID" });
    settings.save({ enabled: true, url: "http://alice:p%40ss@proxy.test:7890" });
    assert.doesNotMatch(JSON.stringify(repository.getSetting("http-proxy")), /alice|p%40ss|proxy.test/);
    repository.close(); repository = new AuthRepository({ filename });
    settings = new ProxySettings({ repository, vault });
    assert.equal(settings.environment().HTTPS_PROXY, "http://alice:p%40ss@proxy.test:7890/");
    assert.equal(settings.environment().NO_PROXY, "");
    settings.save({ enabled: false });
    assert.ok(Object.values(settings.environment()).every((v) => v === ""));
    settings.save({ enabled: true });
    assert.equal(settings.environment().http_proxy, "http://alice:p%40ss@proxy.test:7890/");
    settings.save({ enabled: true, url: "http://new-proxy:8080" });
    assert.equal(settings.environment().HTTP_PROXY, "http://new-proxy:8080/");
    for (const scheme of ["socks5", "socks5h"]) {
      settings.save({ enabled: true, url: `${scheme}://alice:p%40ss@proxy.test:1080` });
      repository.close(); repository = new AuthRepository({ filename });
      settings = new ProxySettings({ repository, vault });
      assert.deepEqual(settings.publicState(), { enabled: true, configured: true, address: `${scheme}://proxy.test:1080` });
      assert.equal(settings.environment().HTTPS_PROXY, "socks5h://alice:p%40ss@proxy.test:1080");
      settings.save({ enabled: false });
      assert.ok(Object.values(settings.environment()).every((v) => v === ""));
      settings.save({ enabled: true });
      assert.equal(settings.environment().http_proxy, "socks5h://alice:p%40ss@proxy.test:1080");
      assert.doesNotMatch(JSON.stringify(repository.getSetting("http-proxy")), /alice|p%40ss|proxy.test/);
    }
    settings.save({ enabled: false, url: "" });
    assert.equal(settings.publicState().configured, false);
  } finally { repository.close(); await rm(dir, { recursive: true, force: true }); }
});
