import { defineConfig } from "@playwright/test";

// Lightweight Playwright config for the e2e suite under tests-e2e/.
// We rely on dev servers being started outside this config (so flaky
// install/teardown stays under the engineer's control).
export default defineConfig({
  testDir: "./tests-e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
