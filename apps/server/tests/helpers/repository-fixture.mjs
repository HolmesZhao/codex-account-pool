import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodexRepository } from "../../src/storage/codex-account-repository.mjs";

export async function createRepositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-pool-repo-"));
  const repository = await createCodexRepository({ databaseUrl: join(directory, "pool.sqlite") });
  return {
    repository,
    close: async () => {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
