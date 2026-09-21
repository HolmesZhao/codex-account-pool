import { createAuthContext } from "../auth/auth-context.mjs";
import { codexError } from "../common/contracts.mjs";
import { json, raw, readJson } from "./http-utils.mjs";

export async function routeCodex({ request, path, method, services }) {
  const subject = await createAuthContext(request, services.authService);
  if (method === "GET" && path === "/api/codex/accounts") return json(200, { data: await services.accounts.list(subject) });
  if (method === "POST" && path === "/api/codex/accounts/import") {
    const body = await readJson(request, 256 * 1024);
    return json(201, { data: await services.accounts.importAuth(subject, body.auth, body) });
  }
  if (method === "GET" && path === "/api/codex/pools") return json(200, { data: await services.pools.list(subject) });
  if (method === "POST" && path === "/api/codex/pools") return json(201, { data: await services.pools.save(subject, await readJson(request)) });
  if (method === "GET" && path === "/api/codex/users") { await services.permissionService.require(subject, "admin:manage"); return json(200, { data: services.authService.listUsers() }); }
  if (method === "GET" && path === "/api/codex/audit") { await services.permissionService.require(subject, "admin:manage"); return json(200, { data: await services.repository.listAudits({}) }); }
  if (method === "GET" && path === "/api/codex/credential-keys") { await services.permissionService.require(subject, "admin:manage"); return json(200, { data: await services.repository.listCredentialKeys() }); }
  if (method === "POST" && path === "/api/codex/credential-keys/rotate") return json(200, { data: await services.credentials.rotateKey(subject) });

  let match = /^\/api\/codex\/pools\/([^/]+)$/.exec(path);
  if (match && method === "PUT") return json(200, { data: await services.pools.save(subject, { ...(await readJson(request)), id: decodeURIComponent(match[1]) }) });
  if (match && method === "DELETE") { await services.pools.remove(subject, decodeURIComponent(match[1])); return json(200, { data: { ok: true } }); }

  match = /^\/api\/codex\/accounts\/([^/]+)$/.exec(path);
  if (match && method === "GET") return json(200, { data: await services.accounts.get(subject, decodeURIComponent(match[1])) });
  if (match && method === "PUT") return json(200, { data: await services.accounts.update(subject, decodeURIComponent(match[1]), await readJson(request)) });
  if (match && method === "DELETE") { await services.accounts.remove(subject, decodeURIComponent(match[1])); return json(200, { data: { ok: true } }); }

  match = /^\/api\/codex\/accounts\/([^/]+)\/quota$/.exec(path);
  if (match && method === "GET") return json(200, { data: await services.quota.get(subject, decodeURIComponent(match[1])) });
  if (match && method === "POST") return json(200, { data: await services.quota.refresh(subject, decodeURIComponent(match[1])) });

  match = /^\/api\/codex\/accounts\/([^/]+)\/check-credential$/.exec(path);
  if (match && method === "POST") return json(200, { data: await services.credentials.inspect(subject, decodeURIComponent(match[1])) });

  match = /^\/api\/codex\/accounts\/([^/]+)\/(raw-)?download-ticket$/.exec(path);
  if (match && method === "POST") return json(201, { data: await services.credentials.issueDownloadTicket(subject, decodeURIComponent(match[1]), match[2] ? "raw" : "at-only") });

  match = /^\/api\/codex\/(raw-)?download-tickets\/([^/]+)$/.exec(path);
  if (match && method === "GET") {
    const result = await services.credentials.consumeDownloadTicket(subject, decodeURIComponent(match[2]), match[1] ? "raw" : "at-only");
    return raw(200, JSON.stringify(result.auth), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-codex-account-id": result.accountId, "x-codex-auth-generation": String(result.generation), "x-codex-auth-sha256": result.sha256 });
  }

  if (method === "POST" && path === "/api/codex/login-flows") return json(201, { data: await services.loginFlows.start(subject, await readJson(request)) });
  match = /^\/api\/codex\/login-flows\/([^/]+)\/(poll|cancel)$/.exec(path);
  if (match && method === "POST") return json(200, { data: await services.loginFlows[match[2]](subject, decodeURIComponent(match[1])) });
  throw codexError("CODEX_ROUTE_NOT_FOUND", "接口不存在", 404);
}
