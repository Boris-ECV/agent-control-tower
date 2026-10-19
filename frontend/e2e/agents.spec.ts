import { expect, test } from "@playwright/test";

test("agents page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/agents");

  // Scoped to <header> because the sidebar nav (components/layout/app-sidebar.tsx)
  // also renders the literal text "Agent Control Tower", which makes the
  // unscoped locator ambiguous under Playwright's strict mode (see
  // cost-dashboard.spec.ts).
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent 清單" }),
  ).toBeVisible();
});

test("sidebar Agent 清單項目可導覽至 /agents", async ({ page }) => {
  await page.goto("/cost-dashboard");

  await page.getByRole("link", { name: "Agent 清單" }).click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("heading", { name: "Agent 清單" }),
  ).toBeVisible();
});
