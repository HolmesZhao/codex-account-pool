export function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
export function credentialLabel(mode: string, status: string) {
  if (status === "needs_reauth") return "需要重新登录";
  return mode === "managed" ? "服务端自动续期" : mode === "at-only" ? "仅 AT（无 RT）" : "待建立服务端托管";
}
export function statusTone(status: string) { return status === "ready" ? "success" : status === "needs_reauth" ? "warning" : "danger"; }
export function planLabel(value?: string | null) {
  if (!value) return "待识别";
  return ({ free: "Free", plus: "Plus", pro: "Pro", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu" } as Record<string, string>)[value.toLowerCase()] || value;
}
