import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  webServer: {
    command: "env -u NO_COLOR pnpm --dir examples/playwright-vite dev --host 127.0.0.1 --port 4174",
    cwd: import.meta.dirname,
    reuseExistingServer: !process.env.CI,
    url: "http://127.0.0.1:4174",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
})
