import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4317", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "CODEX_POOL_DATABASE_URL=:memory: CODEX_POOL_AUTH_DATABASE_URL=:memory: CODEX_POOL_CREDENTIAL_KEY=0505050505050505050505050505050505050505050505050505050505050505 CODEX_POOL_ADMIN_USERNAME=admin CODEX_POOL_ADMIN_PASSWORD=admin-pass-123 CODEX_POOL_MAINTENANCE_DISABLED=1 node ../server/src/server.mjs",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
