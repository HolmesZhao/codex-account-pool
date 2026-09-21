#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, ["--test", resolve(root, "tests/helper.test.mjs")], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
