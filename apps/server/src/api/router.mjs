import { codexError } from "../common/contracts.mjs";
import { json } from "./http-utils.mjs";
import { routeAuth } from "./auth-routes.mjs";
import { routeCodex } from "./codex-routes.mjs";

export async function routeRequest({ request, services, config = {} }) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const path = url.pathname;
  const method = String(request.method || "GET").toUpperCase();
  if (path === "/api/openapi/account" && method === "GET") return routeOpenApiAccount({ request, services });
  if (method === "GET" && path === "/api/health") return json(200, { data: { ok: true, service: "codex-account-pool" } });
  if (path.startsWith("/api/auth/")) {
    const result = await routeAuth({ request, path, method, authService: services.authService });
    if (result) return result;
  }
  if (path.startsWith("/api/codex/")) return routeCodex({ request, path, method, services });
  throw codexError("CODEX_ROUTE_NOT_FOUND", "接口不存在", 404);
}

async function routeOpenApiAccount({ request, services }) {
  const supplied = request.headers["x-api-key"] || request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const binding = services.openApiSettings.authenticate(supplied);
  if (!binding) throw codexError("CODEX_OPENAPI_UNAUTHORIZED", "API Key 无效", 401);
  const accountId = binding.accountId;
  const account = await services.repository.getAccount(accountId);
  if (!account) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "API Key 绑定的账号不存在", 404);
  if (!account.enabled || ["quarantined", "needs_reauth"].includes(account.status)) throw codexError("CODEX_ACCOUNT_UNAVAILABLE", "绑定账号已停用或需要重新登录", 409);
  const snapshot = await services.repository.getLatestQuota(accountId);
  const quota = snapshot?.payload || { stale: true, collectedAt: null, error: "尚无缓存额度" };
  const current = await services.accounts.get({ user: { id: "openapi", role: "admin", enabled: true } }, accountId);
  if (!current.enabled || ["quarantined", "needs_reauth"].includes(current.status)) throw codexError("CODEX_ACCOUNT_UNAVAILABLE", "绑定账号不可用", 409);
  if (services.openApiSettings.authenticate(supplied)?.id !== binding.id) throw codexError("CODEX_OPENAPI_UNAUTHORIZED", "API Key 已停用或撤销", 401);
  const credential = await services.credentials.currentAt(accountId);
  return { status: 200, body: { data: { accountId, email: account.email, accessToken: credential.accessToken, auth: credential.auth, tokenExpiresAt: credential.tokenExpiresAt, generation: credential.generation, quota } }, headers: { "cache-control": "no-store" } };
}
