export function normalizeAccountUsageSnapshot(current, { previous = null, now = new Date(), error = "" } = {}) {
  if (!current) {
    return {
      ...(previous || emptyUsage(now)),
      stale: true,
      error: safeError(error),
      needsReauth: isAuthenticationError(error),
      observedAt: now.toISOString(),
    };
  }
  const { fiveHour, weekly } = classifyWindows(current);
  return {
    fiveHour: normalizeWindow(fiveHour),
    weekly: normalizeWindow(weekly),
    planType: current.planType || null,
    collectedAt: current.collectedAt || now.toISOString(),
    observedAt: now.toISOString(),
    stale: false,
    error: "",
    needsReauth: false,
  };
}

export function publicAccountUsage(value, options = {}) {
  return normalizeAccountUsageSnapshot(value, options);
}

export function analyzeQuotaWindows({ current = {}, previous = null, activation = null, observedAt = new Date() } = {}) {
  const normalized = normalizeAccountUsageSnapshot(current, { previous, now: observedAt });
  return { ...normalized, activation: activation || null };
}

export function normalizeAnchoredQuota({ current = {}, analyzed = {}, activatedAt = new Date(), verified = true } = {}) {
  return { ...analyzed, ...normalizeAccountUsageSnapshot(current, { now: activatedAt }), anchoredAt: activatedAt.toISOString(), verified };
}

function normalizeWindow(window) {
  if (!window) return null;
  const usedPercent = Math.max(0, Math.min(100, Number(window.usedPercent ?? window.used_percent ?? 0)));
  return { usedPercent, remainingPercent: 100 - usedPercent, resetsAt: normalizeTimestamp(window.resetsAt || window.resets_at || null), windowDurationMins: Number(window.windowDurationMins ?? window.window_duration_mins ?? 0) || null };
}

function classifyWindows(current) {
  const windows = [current.primary, current.secondary].filter(Boolean);
  const hasDurations = windows.some((window) => Number(window.windowDurationMins ?? window.window_duration_mins) > 0);
  if (!hasDurations) return { fiveHour: current.primary || null, weekly: current.secondary || null };
  const duration = (window) => Number(window.windowDurationMins ?? window.window_duration_mins ?? 0);
  return {
    fiveHour: windows.find((window) => duration(window) > 0 && duration(window) <= 24 * 60) || null,
    weekly: windows.find((window) => duration(window) >= 6 * 24 * 60) || null,
  };
}

function normalizeTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString();
  return value;
}

function emptyUsage(now) {
  return { fiveHour: null, weekly: null, planType: null, collectedAt: now.toISOString() };
}

function isAuthenticationError(error) { return /\b(401|unauthori[sz]ed|invalid[_ -]?grant|token expired)\b/i.test(String(error || "")); }
function safeError(error) { return String(error || "").replace(/(?:access|refresh|id)[_-]?token\s*[:=]\s*\S+/gi, "token=[redacted]").slice(0, 240); }
