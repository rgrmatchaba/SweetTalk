import { test, expect } from "@playwright/test";

const hasTestUser = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER_PASSWORD;

test.describe("authenticated app", () => {
  test.skip(!hasTestUser, "Set TEST_USER_EMAIL / TEST_USER_PASSWORD to run authenticated tests");

  test("dashboard loads with greeting and nav", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Caregiver" })).toBeVisible();
  });

  test("voice/chat tabs toggle on dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Voice" })).toBeVisible();
    await page.getByRole("button", { name: "Chat" }).click();
    // chat input should appear once the chat agent has loaded
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 15000 });
  });

  test("can navigate to history, analysis, profile, caregiver, export", async ({ page }) => {
    await page.goto("/dashboard");

    for (const [label, path] of [
      ["History", "/history"],
      ["Analysis", "/analysis"],
      ["Profile", "/profile"],
      ["Caregiver", "/caregiver"],
      ["Export", "/export"],
    ] as const) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
    }
  });
});
