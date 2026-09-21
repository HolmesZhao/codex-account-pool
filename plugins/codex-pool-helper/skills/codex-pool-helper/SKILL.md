---
name: codex-pool-helper
description: Use for standalone Codex account-pool login, account and quota lookup, safe AT-only switching, reconciliation, rollback, and leaving managed credentials.
---

# Codex Pool Helper

Use the bundled CLI at `../../scripts/codex-pool-helper.mjs`. Always pass `--json` when presenting results to the user. Never read, print, summarize, or expose auth.json contents, access tokens, refresh tokens, ID tokens, bearer credentials, or download tickets.

## Commands

- Login: `node ../../scripts/codex-pool-helper.mjs login --json`
- List accessible accounts: `node ../../scripts/codex-pool-helper.mjs accounts --json`
- Read quota: `node ../../scripts/codex-pool-helper.mjs quota <account-id> --json`
- Switch to managed AT-only credentials: `node ../../scripts/codex-pool-helper.mjs switch <account-id> --json`
- Refresh the managed generation: `node ../../scripts/codex-pool-helper.mjs refresh <account-id> --json`
- Reconcile on demand: `node ../../scripts/codex-pool-helper.mjs coordinate --json`
- Restore the previous local auth.json: `node ../../scripts/codex-pool-helper.mjs rollback --json`
- Leave management and restore the backup: `node ../../scripts/codex-pool-helper.mjs release --json`
- Show sanitized status: `node ../../scripts/codex-pool-helper.mjs status --json`

The server URL must come from `CODEX_POOL_SERVER_URL` or the private helper config. Login credentials may come from `CODEX_POOL_USERNAME` and `CODEX_POOL_PASSWORD`; never ask the user to paste a password into chat. SessionStart must always return `continue: true`, including network or malformed-local-file failures.
