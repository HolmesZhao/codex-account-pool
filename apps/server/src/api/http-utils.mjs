import { randomUUID } from "node:crypto";
import { codexError } from "../common/contracts.mjs";

export async function readJson(request, limit = 64 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw codexError("CODEX_BODY_TOO_LARGE", "请求体过大", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw codexError("CODEX_JSON_INVALID", "请求 JSON 无效", 400); }
}

export function json(status, body, headers = {}) { return { status, body, headers }; }
export function raw(status, body, headers = {}) { return { status, body, headers, raw: true }; }
export function requestId(request) { return request.headers["x-request-id"] || randomUUID(); }
export function errorBody(error, id) { return { error: { code: String(error.code || "CODEX_INTERNAL_ERROR"), message: safeMessage(error) }, requestId: id }; }
function safeMessage(error) { return String(error?.message || "服务暂时不可用").replace(/(?:access|refresh|id)[_-]?token\s*[:=]\s*\S+/gi, "token=[redacted]").slice(0, 300); }
