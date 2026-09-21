import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PoolsPage } from "./PoolsPage";
import { accountFixture, poolFixture } from "../../test/fixtures";

describe("PoolsPage", () => {
  it("selects a pool and exposes account and subject editors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify({ data: String(input).includes("accounts") ? accountFixture : poolFixture }), { status: 200, headers: { "content-type": "application/json" } }));
    const user = userEvent.setup(); render(<PoolsPage />);
    await user.click(await screen.findByRole("button", { name: "选择 核心研发池" }));
    expect(screen.getByRole("heading", { name: "核心研发池" })).toBeVisible();
    expect(screen.getByRole("group", { name: "池内账号" })).toBeVisible();
    expect(screen.getByRole("group", { name: "授权对象" })).toBeVisible();
  });
});
