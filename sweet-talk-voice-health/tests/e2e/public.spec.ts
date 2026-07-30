import { test, expect } from "@playwright/test";

// These run without auth — verify the unauthenticated app shell works.

test.use({ storageState: { cookies: [], origins: [] } });

test("redirects to /auth when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth/);
});

test("auth page renders sign in form", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Sweet Talk" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("can toggle between sign in and sign up", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("tab", { name: /sign up/i }).click();
  await expect(page.getByRole("heading", { name: /start your sugar diary/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /create free account/i })).toBeVisible();

  // Typing must not flip the mode pill back to Sign in
  await page.getByLabel("Email").fill("newuser@example.com");
  await page.getByLabel("Password").fill("secret12");
  await expect(page.getByRole("tab", { name: /sign up/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /create free account/i })).toBeVisible();
});
