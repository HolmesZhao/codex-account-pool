import { codexError } from "../common/contracts.mjs";
import { json } from "./http-utils.mjs";
import { routeAuth } from "./auth-routes.mjs";
import { routeCodex } from "./codex-routes.mjs";

export async function routeRequest({ request, services }) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const path = url.pathname;
  const method = String(request.method || "GET").toUpperCase();
  if (method === "GET" && path === "/api/health") return json(200, { data: { ok: true, service: "codex-account-pool" } });
  if (path.startsWith("/api/auth/")) {
    const result = await routeAuth({ request, path, method, authService: services.authService });
    if (result) return result;
  }
  if (path.startsWith("/api/codex/")) return routeCodex({ request, path, method, services });
  throw codexError("CODEX_ROUTE_NOT_FOUND", "接口不存在", 404);
}
