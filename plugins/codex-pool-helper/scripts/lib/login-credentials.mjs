import { requestPool } from "./http-client.mjs";
import { saveHelperConfig } from "./helper-config.mjs";

export async function login(config, env = process.env) {
  const username = env.CODEX_POOL_USERNAME; const password = env.CODEX_POOL_PASSWORD;
  if (!username || !password) throw Object.assign(new Error("请通过 CODEX_POOL_USERNAME 与 CODEX_POOL_PASSWORD 提供登录信息"), { code: "CODEX_POOL_LOGIN_REQUIRED" });
  const result = await requestPool(config, "/api/auth/login", { method: "POST", body: { username, password } });
  await saveHelperConfig(config, { token: result.bearerToken });
  return { user: result.user, loggedIn: true };
}
