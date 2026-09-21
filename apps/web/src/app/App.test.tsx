import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => { window.history.replaceState({}, "", "/accounts"); });

  it("shows the five approved navigation destinations in order", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify({ data: String(input).includes("/api/auth/me") ? { id: "admin", username: "admin", displayName: "管理员", role: "admin", enabled: true } : [] }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["概览", "账号", "号池", "用户授权", "审计"]);
  });

  it("renders login instead of management content after a 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "CODEX_UNAUTHORIZED", message: "请先登录" } }), { status: 401, headers: { "content-type": "application/json" } }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "登录 Codex 号池" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
  });
});
