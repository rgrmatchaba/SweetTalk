import { test, expect } from "@playwright/test";

const hasTestUser = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER_PASSWORD;

test.describe("chat agent", () => {
  test.skip(!hasTestUser, "Set TEST_USER_EMAIL / TEST_USER_PASSWORD to run authenticated tests");

  test("sends a message and gets a reply from the Gatekeeper agent", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Chat" }).click();

    const input = page.getByPlaceholder("Type a message...");
    await expect(input).toBeVisible({ timeout: 15000 });

    const initialBubbles = await page.locator(".whitespace-pre-wrap").count();

    await input.fill("Hi");
    await input.press("Enter");

    // user bubble appears immediately
    await expect(page.locator(".whitespace-pre-wrap")).toHaveCount(initialBubbles + 1);

    // wait for the agent's reply (requires the Mastra dev server to be running
    // at MASTRA_API_URL — this will time out if it isn't)
    await expect(page.locator(".whitespace-pre-wrap")).toHaveCount(initialBubbles + 2, {
      timeout: 30000,
    });
  });
});
