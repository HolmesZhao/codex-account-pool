import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ProxySettingsPanel } from "./ProxySettingsPanel";
import { CreateUserPanel } from "./CreateUserPanel";

it.each(["http", "socks5"])("saves a %s proxy, clears the secret input and preserves credentials on disable", async (scheme) => {
  const bodies: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ data: { enabled: bodies.length === 1, configured: true, address: `${scheme}://proxy.test:7890` } }));
  });
  const user = userEvent.setup(); render(<ProxySettingsPanel />);
  await screen.findByText(/已保存/);
  await user.click(screen.getByLabelText("启用代理"));
  await user.type(screen.getByLabelText("代理地址"), `${scheme}://alice:secret@proxy.test:7890`);
  await user.click(screen.getByRole("button", { name: "保存代理设置" }));
  await screen.findByRole("status");
  expect(screen.getByLabelText("代理地址")).toHaveValue("");
  expect(bodies[0]).toEqual({ enabled: true, url: `${scheme}://alice:secret@proxy.test:7890` });
  await user.click(screen.getByLabelText("启用代理"));
  await user.click(screen.getByRole("button", { name: "保存代理设置" }));
  expect(bodies[1]).toEqual({ enabled: false });
});
it("shows duplicate-user errors and creates a basic user successfully", async () => {
  const created = vi.fn();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "用户名已存在" } }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: { username: "member", role: "basic_user" } })));
  const user = userEvent.setup(); render(<CreateUserPanel onCreated={created} />);
  await user.click(screen.getByRole("button", { name: "创建用户" }));
  await user.type(screen.getByLabelText("用户名"), "member");
  await user.type(screen.getByLabelText("初始密码"), "member-pass-123");
  await user.click(screen.getByRole("button", { name: "确认创建" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("用户名已存在");
  await user.click(screen.getByRole("button", { name: "确认创建" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已创建");
  expect(created).toHaveBeenCalledWith({ username: "member", role: "basic_user" });
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).role).toBe("basic_user");
  expect(screen.queryByLabelText("初始密码")).not.toBeInTheDocument();
});
