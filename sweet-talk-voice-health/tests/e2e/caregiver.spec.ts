import { test, expect } from "@playwright/test";

const hasTestUser = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER_PASSWORD;

test.describe("caregiver page", () => {
  test.skip(!hasTestUser, "Set TEST_USER_EMAIL / TEST_USER_PASSWORD to run authenticated tests");

  test("can save caregiver details", async ({ page }) => {
    await page.goto("/caregiver");
    await expect(page.getByRole("heading", { name: "Caregiver" })).toBeVisible();

    await page.getByLabel("Caregiver name").fill("Test Caregiver");
    await page.getByLabel("Email address").fill("caregiver+playwright@example.com");
    await page.getByLabel("Phone number").fill("+15551234567");

    await page.getByRole("button", { name: "Save caregiver details" }).click();
    await expect(page.getByText("Caregiver details saved")).toBeVisible();

    // reload and confirm it persisted
    await page.reload();
    await expect(page.getByLabel("Email address")).toHaveValue("caregiver+playwright@example.com");
  });

  test("rejects an invalid caregiver email", async ({ page }) => {
    await page.goto("/caregiver");
    await page.getByLabel("Email address").fill("not-an-email");
    await page.getByRole("button", { name: "Save caregiver details" }).click();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });
});
