#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const checks = [
  ["后端单元与接口测试", ["test", "--workspace", "@codex-pool/server"]],
  ["前端单元测试", ["test", "--workspace", "@codex-pool/web"]],
  ["Helper 安全测试", ["./plugins/codex-pool-helper/scripts/self-test.mjs"]],
  ["前端生产构建", ["run", "build"]],
  ["浏览器端到端测试", ["run", "test:e2e", "--workspace", "@codex-pool/web"]],
];

for (const [label, args] of checks) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = args[0].startsWith("./")
    ? spawnSync(process.execPath, args, { stdio: "inherit" })
    : spawnSync("npm", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write("\n全部自检通过。\n");
