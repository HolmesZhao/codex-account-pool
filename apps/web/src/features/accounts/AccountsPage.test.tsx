import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsPage } from "./AccountsPage";
import { accountFixture, poolFixture } from "../../test/fixtures";

describe("AccountsPage", () => {
  it("renders summary, account table and detail drawer", async () => {
    mockApi(accountFixture);
    const user = userEvent.setup();
    render(<AccountsPage />);
    expect(await screen.findByRole("heading", { name: "账号运行状态" })).toBeVisible();
    expect(screen.getByText("集中查看凭证、额度与轮换状态。")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "5 小时额度" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "账户类型" })).toBeVisible();
    expect(screen.getByText("Plus")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看 lin@example.com" }));
    expect(screen.getByRole("dialog", { name: "lin@example.com 账号详情" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "登录与凭证" })).toBeVisible();
  });

  it("keeps previous quota and reports stale refresh", async () => {
    mockApi(accountFixture);
    const user = userEvent.setup();
    render(<AccountsPage />);
    await screen.findByText("lin@example.com");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "CODEX_UPSTREAM_UNAVAILABLE", message: "暂时无法刷新" } }), { status: 503, headers: { "content-type": "application/json" } }));
    await user.click(screen.getByRole("button", { name: "刷新 lin@example.com 额度" }));
    expect(await screen.findByText("暂时无法刷新，正在显示上次成功数据")).toBeVisible();
    expect(screen.getByText("58%")).toBeVisible();
  });
});

function mockApi(accounts = accountFixture) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input);
    const data = path.includes("/pools") ? poolFixture : accounts;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  });
}
