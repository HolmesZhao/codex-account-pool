import { randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export class PoolService {
  constructor({ repository, permissionService }) { this.repository = repository; this.permissionService = permissionService; }

  async list(subject) {
    await this.permissionService.require(subject, "codex_account:read");
    const pools = await this.repository.listPools();
    if (subject.user.role === "admin") return Promise.all(pools.map((pool) => this.#details(pool)));
    const allowed = new Set(await this.repository.listAccessibleAccountIds({ userId: subject.user.id, roles: [subject.user.role] }));
    const details = await Promise.all(pools.map((pool) => this.#details(pool)));
    return details.filter((pool) => pool.accountIds.some((id) => allowed.has(id)));
  }

  async save(subject, input) {
    await this.permissionService.require(subject, "codex_pool:manage");
    const name = String(input.name || "").trim();
    if (!name) throw codexError("CODEX_POOL_INVALID", "号池名称不能为空", 400);
    const id = input.id || randomUUID();
    const pool = await this.repository.savePool({ id, name, description: String(input.description || "").trim(), enabled: input.enabled !== false });
    if (input.accountIds) await this.repository.setPoolAccounts(id, [...new Set(input.accountIds)]);
    if (input.subjects) await this.repository.setPoolSubjects(id, normalizeSubjects(input.subjects));
    await this.repository.appendAudit({ actorId: subject.user.id, action: input.id ? "pool.update" : "pool.create", targetType: "pool", targetId: id, result: "success" });
    return this.#details(pool);
  }

  async remove(subject, id) {
    await this.permissionService.require(subject, "codex_pool:manage");
    await this.repository.deletePool(id);
    await this.repository.appendAudit({ actorId: subject.user.id, action: "pool.delete", targetType: "pool", targetId: id, result: "success" });
  }

  async #details(pool) {
    return { ...pool, accountIds: await this.repository.getPoolAccountIds(pool.id), subjects: await this.repository.getPoolSubjects(pool.id) };
  }
}

function normalizeSubjects(subjects) {
  return [...new Map(subjects.map((subject) => [`${subject.type}:${subject.id}`, { type: subject.type, id: String(subject.id) }])).values()]
    .filter((subject) => ["user", "role"].includes(subject.type) && subject.id);
}
