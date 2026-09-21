import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AuditPage } from "./AuditPage";
import { auditFixture } from "../../test/fixtures";

it("renders operation audit with human readable action", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: auditFixture }), { status: 200, headers: { "content-type": "application/json" } }));
  render(<AuditPage />);
  expect(await screen.findByText("导入账号")).toBeVisible();
  expect(screen.getByText("acct-a")).toBeVisible();
  expect(screen.getByText("成功")).toBeVisible();
});
