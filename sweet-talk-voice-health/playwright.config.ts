import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Sweet Talk.
 *
 * Auth-required tests are skipped unless TEST_USER_EMAIL / TEST_USER_PASSWORD
 * are set (see tests/e2e/auth.setup.ts). Create a throwaway test account in
 * your Supabase project and put the credentials in a local .env.test:
 *
 *   TEST_USER_EMAIL=test@example.com
 *   TEST_USER_PASSWORD=...
 *
 * Run with: npx playwright test
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
});
