import { test, expect } from "@playwright/test";

test.describe("export route (no auth)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects unauthenticated users to auth", async ({ page }) => {
    await page.goto("/export");
    await expect(page).toHaveURL(/\/auth/);
  });
});
