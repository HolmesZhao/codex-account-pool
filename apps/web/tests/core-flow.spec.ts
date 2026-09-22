import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("administrator logs in, imports an account and creates a pool", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "导入账号" }).click();
  await page.getByLabel("auth.json 文件").setInputFiles(resolve("tests/fixtures/auth-at-only.json"));
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("账号导入成功")).toBeVisible();
  await page.getByRole("button", { name: "查看 lin@example.com" }).click();
  await expect(page.getByRole("heading", { name: "自动续期", exact: true })).toBeVisible();
  await expect(page.getByText("无 RT，需手动登录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "立即轮换凭证" })).toBeDisabled();
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

test("administrator saves proxy settings and creates a user who can log in", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "用户授权", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存代理设置" })).toBeEnabled();
  await page.getByLabel("启用代理").check();
  await page.getByLabel("代理地址").fill("http://testuser:testpassword@192.0.2.1:7890");
  await page.getByRole("button", { name: "保存代理设置" }).click();
  await expect(page.getByText(/已保存，后续设备登录/)).toBeVisible();
  await page.getByLabel("代理地址").fill("socks5://testuser:testpassword@192.0.2.1:1080");
  await page.getByRole("button", { name: "保存代理设置" }).click();
  await expect(page.getByText(/已保存：socks5:\/\/192.0.2.1:1080/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("启用代理")).toBeChecked();
  await expect(page.getByLabel("代理地址")).toHaveValue("");
  await page.getByLabel("启用代理").uncheck();
  await page.getByRole("button", { name: "保存代理设置" }).click();
  await expect(page.getByText(/已保存，后续设备登录/)).toBeVisible();
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("用户名", { exact: true }).fill("newmember");
  await page.getByLabel("显示名称").fill("新成员");
  await page.getByLabel("初始密码").fill("member-pass-123");
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByText(/用户 newmember 已创建/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "newmember 新成员" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByLabel("用户名").fill("newmember");
  await page.getByLabel("密码", { exact: true }).fill("member-pass-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "无权访问" })).toBeVisible();
  await expect(page.getByRole("link", { name: "用户授权", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账号运行状态" })).toBeVisible();
});
