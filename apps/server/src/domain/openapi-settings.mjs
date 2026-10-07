import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

const CONTEXT = { accountId: "system:openapi", generation: 1 };
const digest = (key) => createHash("sha256").update(key).digest("hex");
export class OpenApiSettings {
  constructor({ repository, vault, accounts }) { Object.assign(this, { repository, vault, accounts }); }
  read() {
    const saved = this.repository.getSetting("openapi-keys");
    return saved ? this.vault.decrypt(saved, CONTEXT) : [];
  }
  publicList() { return this.read().map(({ keyDigest, ...item }) => item); }
  authenticate(key) {
    if (typeof key !== "string" || !key || key.length > 256) return null;
    const candidate = Buffer.from(digest(key), "hex");
    return this.read().find(item => item.enabled && timingSafeEqual(candidate, Buffer.from(item.keyDigest, "hex"))) || null;
  }
  async create(input) {
    const label = typeof input?.label === "string" ? input.label.trim() : "";
    const accountId = typeof input?.accountId === "string" ? input.accountId.trim() : "";
    if (!label || label.length > 100 || !accountId) throw codexError("CODEX_OPENAPI_SETTINGS_INVALID", "请填写名称（最多 100 字）和绑定账号", 400);
    const account = await this.accounts.getAccount(accountId);
    if (!account?.enabled) throw codexError("CODEX_ACCOUNT_NOT_FOUND", "请选择已启用的账号", 400);
    const apiKey = `cpk_${randomBytes(32).toString("base64url")}`;
    const item = { id: randomUUID(), label, accountId, keyDigest: digest(apiKey), maskedKey: `${apiKey.slice(0, 8)}••••${apiKey.slice(-4)}`, enabled: true, createdAt: new Date().toISOString() };
    this.save([...this.read(), item]);
    const { keyDigest, ...publicItem } = item;
    return { ...publicItem, apiKey };
  }
  update(id, input) {
    if (typeof input?.enabled !== "boolean") throw codexError("CODEX_OPENAPI_SETTINGS_INVALID", "请提供有效的启用状态", 400);
    const items = this.read(); const item = items.find(value => value.id === id);
    if (!item) throw missing();
    item.enabled = input.enabled; this.save(items);
    const { keyDigest, ...publicItem } = item; return publicItem;
  }
  remove(id) { const items = this.read(); if (!items.some(item => item.id === id)) throw missing(); this.save(items.filter(item => item.id !== id)); }
  save(items) { this.repository.saveSetting("openapi-keys", this.vault.encrypt(items, CONTEXT)); }
}
function missing() { return codexError("CODEX_OPENAPI_KEY_NOT_FOUND", "API Key 不存在", 404); }
