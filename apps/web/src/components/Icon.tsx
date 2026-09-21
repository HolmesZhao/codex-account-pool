import type { LucideIcon } from "lucide-react";

export function Icon({ icon: Glyph, size = 18 }: { icon: LucideIcon; size?: number }) {
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} />;
}
