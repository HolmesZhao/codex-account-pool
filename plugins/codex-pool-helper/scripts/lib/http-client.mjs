export async function requestPool(config, path, { method = "GET", body, raw = false, timeoutMs = 8_000 } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.serverUrl}${path}`, { method, signal: controller.signal, headers: { ...(config.token ? { authorization: `Bearer ${config.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error?.message || `号池服务返回 ${response.status}`), { code: payload.error?.code || "CODEX_POOL_REQUEST_FAILED", status: response.status });
    return raw ? payload : (payload.data ?? payload);
  } finally { clearTimeout(timer); }
}
