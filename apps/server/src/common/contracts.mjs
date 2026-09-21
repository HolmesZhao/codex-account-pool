export const CODEX_ACTIONS = Object.freeze([
  "codex_account:read",
  "codex_account:use",
  "codex_account:import",
  "codex_account:reauth",
  "codex_account:raw_export",
  "codex_quota:read",
  "codex_account:manage",
  "codex_pool:manage",
  "admin:manage",
]);

const memberActions = Object.freeze([
  "codex_account:read",
  "codex_account:use",
  "codex_account:import",
  "codex_account:reauth",
  "codex_quota:read",
]);

export const ROLE_ACTIONS = Object.freeze({
  basic_user: memberActions,
  developer: memberActions,
  expert: memberActions,
  admin: CODEX_ACTIONS,
});

export function codexError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
