import { test, expect } from "@playwright/test";

const hasTestUser = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER_PASSWORD;

test.describe("export page", () => {
  test.skip(!hasTestUser, "Set TEST_USER_EMAIL / TEST_USER_PASSWORD to run authenticated tests");

  test("export page loads and can download PDF without AI", async ({ page }) => {
    await page.goto("/export");
    await expect(page).toHaveURL(/\/export/);
    await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();
    await expect(page.getByText("Download a clinical PDF")).toBeVisible();

    // Disable AI to keep the test fast and avoid LLM dependency
    const aiCheckbox = page.getByRole("checkbox", { name: /Include AI clinical observations/i });
    await aiCheckbox.click();
    await expect(aiCheckbox).not.toBeChecked();

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.getByRole("button", { name: /Download clinical PDF/i }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/clinical-glucose-report-.+\.pdf$/);

    const savePath = await download.path();
    expect(savePath).toBeTruthy();
  });

  test("can download PDF with AI analysis (Anthropic)", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/export");
    await expect(page.getByRole("checkbox", { name: /Include AI clinical observations/i })).toBeChecked();

    const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
    await page.getByRole("button", { name: /Download clinical PDF/i }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/clinical-glucose-report-.+\.pdf$/);
  });
});
