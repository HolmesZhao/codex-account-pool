import { BarChart3, BookOpenCheck, Layers3, ShieldCheck, UsersRound } from "lucide-react";

export const routes = [
  { path: "/", label: "概览", icon: BarChart3 },
  { path: "/accounts", label: "账号", icon: UsersRound },
  { path: "/pools", label: "号池", icon: Layers3 },
  { path: "/authorization", label: "用户授权", icon: ShieldCheck },
  { path: "/audit", label: "审计", icon: BookOpenCheck },
] as const;
