import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authFile = "tests/e2e/.auth/user.json";

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

setup("authenticate", async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    // No test credentials configured — write an empty storage state so
    // dependent tests can still load (they'll be redirected to /auth and
    // should handle that, or be skipped individually).
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  await page.goto("/auth");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await page.context().storageState({ path: authFile });
});
