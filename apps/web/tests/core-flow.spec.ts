import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("administrator logs in, imports an account and creates a pool", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "导入账号" }).click();
  await page.getByLabel("auth.json 文件").setInputFiles(resolve("tests/fixtures/auth-at-only.json"));
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("账号导入成功")).toBeVisible();
  await page.getByRole("button", { name: "查看 lin@example.com" }).click();
  await page.getByRole("button", { name: "检查凭证" }).click();
  await expect(page.getByText("凭证解密与摘要检查通过")).toBeVisible();
  await page.getByLabel("账号别名").fill("生产主账号");
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(page.getByText("账号设置已保存")).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("link", { name: "用户授权", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "轮换密钥" }).click();
  await expect(page.getByText("已切换到 v2，重加密 1 个账号")).toBeVisible();
  await page.getByRole("link", { name: "号池", exact: true }).click();
  await page.getByRole("button", { name: "新建号池" }).click();
  await page.getByLabel("号池名称").fill("核心研发池");
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(page.getByRole("button", { name: "选择 核心研发池" })).toBeVisible();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/accounts");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin-pass-123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "账号运行状态" })).toBeVisible();
}
