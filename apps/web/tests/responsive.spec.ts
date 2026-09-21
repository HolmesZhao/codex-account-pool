import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("360px account list has no overflow and detail sheet restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/accounts");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin-pass-123");
  await page.getByRole("button", { name: "登录" }).click();
  if (await page.getByRole("button", { name: "导入账号" }).isVisible()) {
    const existing = page.getByText("lin@example.com");
    if (!(await existing.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "导入账号" }).click();
      await page.getByLabel("auth.json 文件").setInputFiles(resolve("tests/fixtures/auth-at-only.json"));
      await page.getByRole("button", { name: "确认导入" }).click();
    }
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const trigger = page.getByRole("button", { name: "查看 lin@example.com" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: /lin@example.com 账号详情/ })).toBeFocused();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(trigger).toBeFocused();
});
