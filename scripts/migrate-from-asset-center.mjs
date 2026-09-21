#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createCodexRepository } from "../apps/server/src/storage/codex-account-repository.mjs";
import { codexError } from "../apps/server/src/common/contracts.mjs";

export async function migrateCodexData({ source, target, dryRun = false }) {
  const [keys, pools, accounts, revisions, quotas, activations, audits] = await Promise.all([
    source.listCredentialKeys(), source.listPools(), source.listAccounts(), source.listAllRevisions(),
    source.listQuotaSnapshots(), source.listQuotaActivations(), source.listAudits({ limit: 1_000_000 }),
  ]);
  const versions = new Set(keys.map((key) => key.version));
  const missing = revisions.find((revision) => !versions.has(revision.keyVersion));
  if (missing) throw codexError("CODEX_MIGRATION_KEY_VERSION_MISSING", `凭证代次 ${missing.accountId}/${missing.generation} 缺少密钥版本 ${missing.keyVersion}`, 409);
  if ((await target.listAccounts()).length || (await target.listPools()).length) throw codexError("CODEX_MIGRATION_TARGET_NOT_EMPTY", "目标数据库不是空库", 409);
  const report = { counts: { keys: keys.length, pools: pools.length, accounts: accounts.length, revisions: revisions.length, quotas: quotas.length, activations: activations.length, audits: audits.length }, digestMismatches: [] };
  if (dryRun) return { ...report, dryRun: true };

  await target.transaction(async () => {
    for (const key of keys) await target.saveCredentialKey(key);
    for (const pool of pools) await target.savePool(pool);
    for (const account of accounts) await target.saveAccount({ ...account, generation: 0 });
    for (const pool of pools) {
      await target.setPoolAccounts(pool.id, await source.getPoolAccountIds(pool.id));
      await target.setPoolSubjects(pool.id, await source.getPoolSubjects(pool.id));
    }
    for (const revision of revisions) {
      const committed = await target.commitRevision({ accountId: revision.accountId, expectedGeneration: revision.generation - 1, revision });
      if (committed.sha256 !== revision.sha256) report.digestMismatches.push(`${revision.accountId}:${revision.generation}`);
    }
    for (const quota of quotas) await target.saveQuotaSnapshot(quota);
    for (const activation of activations) await target.saveQuotaActivation(activation);
    for (const audit of audits.reverse()) await target.appendAudit(audit);
    if (report.digestMismatches.length) throw codexError("CODEX_MIGRATION_DIGEST_MISMATCH", "迁移后凭证摘要不一致", 409);
  });
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.target) throw new Error("Usage: migrate-from-asset-center --source <database> --target <database> [--dry-run]");
  const source = await createCodexRepository({ databaseUrl: args.source });
  const target = await createCodexRepository({ databaseUrl: args.target });
  try { console.log(JSON.stringify(await migrateCodexData({ source, target, dryRun: args.dryRun }), null, 2)); }
  finally { await source.close(); await target.close(); }
}
function parseArgs(argv) { const value = { dryRun: argv.includes("--dry-run") }; for (let i = 0; i < argv.length; i += 1) if (["--source", "--target"].includes(argv[i])) value[argv[i].slice(2)] = argv[i + 1]; return value; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
