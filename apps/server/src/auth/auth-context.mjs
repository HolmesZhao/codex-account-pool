import { randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export async function createAuthContext(request, authService) {
  const headers = request.headers || {};
  const authorization = getHeader(headers, "authorization");
  const cookie = getHeader(headers, "cookie");
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization || "")?.[1];
  const session = /(?:^|;\s*)codex_pool_session=([^;]+)/.exec(cookie || "")?.[1];
  const token = bearer || session;
  if (!token) throw codexError("CODEX_UNAUTHORIZED", "请先登录", 401);
  return { ...(await authService.authenticateSession(token, bearer ? "bearer" : "cookie")), requestId: randomUUID(), token };
}

function getHeader(headers, name) {
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || "";
}
