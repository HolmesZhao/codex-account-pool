#!/usr/bin/env node
import http from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthRepository } from "./auth/auth-repository.mjs";
import { AuthService } from "./auth/auth-service.mjs";
import { PermissionService } from "./auth/permission-service.mjs";
import { createCodexRepository } from "./storage/codex-account-repository.mjs";
import { CodexCredentialVault } from "./domain/codex-credential-vault.mjs";
import { PoolService } from "./domain/pool-service.mjs";
import { AccountService } from "./domain/account-service.mjs";
import { CredentialService } from "./domain/credential-service.mjs";
import { QuotaService } from "./domain/quota-service.mjs";
import { LoginFlowService } from "./domain/login-flow-service.mjs";
import { MaintenanceScheduler } from "./domain/maintenance-scheduler.mjs";
import { CodexRuntime } from "./runtime/codex-runtime.mjs";
import { routeRequest } from "./api/router.mjs";
import { errorBody, requestId } from "./api/http-utils.mjs";
import { resolveConfig } from "./config/config.mjs";

const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export async function createCodexPoolServer(options = {}) {
  const config = { ...resolveConfig(options.env), ...options };
  const repository = options.repository || await createCodexRepository({ databaseUrl: config.databaseUrl, postgresSchema: config.postgresSchema });
  if ((await repository.listCredentialKeys()).length === 0) {
    const fingerprint = createHash("sha256").update(Buffer.isBuffer(config.credentialKey) ? config.credentialKey : String(config.credentialKey)).digest("hex").slice(0, 16);
    await repository.saveCredentialKey({ version: 1, encryptedKey: `external:${fingerprint}`, active: true });
  }
  const authRepository = options.authRepository || new AuthRepository({ filename: config.authDatabaseUrl });
  const authService = options.authService || new AuthService({ repository: authRepository, provenanceSecret: config.sessionSecret });
  if (config.admin && authService.listUsers().length === 0) await authService.createUser({ ...config.admin, role: "admin", displayName: "管理员" });
  const permissionService = new PermissionService();
  const runtime = options.runtime || new CodexRuntime({ command: config.codexCommand });
  const vault = options.vault || new CodexCredentialVault(config.credentialKey);
  const services = {
    repository, authService, permissionService, runtime,
    pools: new PoolService({ repository, permissionService }),
    accounts: new AccountService({ repository, permissionService, vault }),
    credentials: new CredentialService({ repository, permissionService, vault }),
    quota: new QuotaService({ repository, permissionService, runtime, vault }),
  };
  services.loginFlows = new LoginFlowService({ repository, permissionService, runtime, accountService: services.accounts });
  const scheduler = new MaintenanceScheduler({ listAccountIds: async () => (await repository.listAccounts()).map((account) => account.id), maintain: async (id) => services.quota.refresh(systemAdmin(), id) });
  if (!config.maintenanceDisabled) scheduler.start();
  const server = http.createServer(async (request, response) => {
    const id = requestId(request);
    try {
      if (!request.url.startsWith("/api/") && serveStatic(request, response, config.webDist || WEB_DIST)) return;
      const result = await routeRequest({ request, services });
      response.writeHead(result.status, { "content-type": "application/json; charset=utf-8", "x-request-id": id, ...(result.headers || {}) });
      response.end(result.raw ? result.body : JSON.stringify({ ...result.body, requestId: id }));
    } catch (error) {
      response.writeHead(error.status || 500, { "content-type": "application/json; charset=utf-8", "x-request-id": id, "cache-control": "no-store" });
      response.end(JSON.stringify(errorBody(error, id)));
    }
  });
  return {
    server, services,
    async close() {
      await scheduler.stop();
      await runtime.close?.();
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await repository.close();
      authRepository.close();
    },
  };
}

function serveStatic(request, response, root) {
  if (!existsSync(root)) return false;
  const url = new URL(request.url, "http://localhost");
  let path = join(root, url.pathname === "/" ? "index.html" : url.pathname);
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) path = join(root, "index.html");
  response.writeHead(200, { "content-type": mime(extname(path)), "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
  createReadStream(path).pipe(response);
  return true;
}
function mime(extension) { return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" })[extension] || "application/octet-stream"; }
function systemAdmin() { return { user: { id: "system", username: "system", displayName: "系统", role: "admin", enabled: true }, authFingerprint: "system", authType: "system" }; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = resolveConfig();
  const app = await createCodexPoolServer(config);
  app.server.listen(config.port, config.host, () => console.log(`Codex account pool listening on http://${config.host}:${config.port}`));
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}
