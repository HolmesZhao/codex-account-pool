import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AuthorizationPage } from "./AuthorizationPage";
import { adminUser, poolFixture } from "../../test/fixtures";

it("shows user role, status and accessible pools", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify({ data: String(input).includes("users") ? [adminUser] : poolFixture }), { status: 200, headers: { "content-type": "application/json" } }));
  render(<AuthorizationPage />);
  expect(await screen.findByText("admin")).toBeVisible();
  expect(screen.getAllByText("管理员")).toHaveLength(2);
  expect(screen.getByText("全部号池")).toBeVisible();
});
