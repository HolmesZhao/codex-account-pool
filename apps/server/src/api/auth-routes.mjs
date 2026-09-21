import { createAuthContext } from "../auth/auth-context.mjs";
import { json, readJson } from "./http-utils.mjs";

export async function routeAuth({ request, path, method, authService }) {
  if (method === "POST" && path === "/api/auth/login") {
    const login = await authService.login(await readJson(request));
    return json(200, { data: { user: login.user, bearerToken: login.bearerToken } }, { "set-cookie": login.cookie });
  }
  const subject = await createAuthContext(request, authService);
  if (method === "GET" && path === "/api/auth/me") return json(200, { data: authService.me(subject) });
  if (method === "POST" && path === "/api/auth/logout") {
    await authService.logout(subject.token);
    return json(200, { data: { ok: true } }, { "set-cookie": "codex_pool_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict" });
  }
  if (method === "POST" && path === "/api/auth/password") { await authService.changePassword(subject, await readJson(request)); return json(200, { data: { ok: true } }); }
  if (method === "GET" && path === "/api/auth/trust-bundle") return json(200, { data: { issuer: "codex-account-pool", algorithms: ["HS256"] } });
  if (method === "POST" && path === "/api/auth/aac-auth") return json(200, { data: { bearerToken: subject.token, user: subject.user } });
  return null;
}
