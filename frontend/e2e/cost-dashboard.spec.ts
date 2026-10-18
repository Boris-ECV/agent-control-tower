import { expect, test } from "@playwright/test";

test("cost dashboard page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/cost-dashboard");

  // Scoped to <header> because the sidebar nav (components/layout/app-sidebar.tsx)
  // also renders the literal text "Agent Control Tower", which makes the
  // unscoped locator ambiguous under Playwright's strict mode.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "成本總覽" }),
  ).toBeVisible();
});
