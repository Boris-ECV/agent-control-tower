import { expect, test } from "@playwright/test";

test("cost dashboard page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/cost-dashboard");

  // The sticky header no longer duplicates the sidebar's product title
  // (SDLCCT-68); the sidebar nav (components/layout/app-sidebar.tsx) remains
  // the sole place "Agent Control Tower" is rendered.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "成本總覽" }),
  ).toBeVisible();
});

test("SDLCCT-94: summary cards show amounts as integers", async ({ page }) => {
  await page.route("**/api/cost-overview/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-28",
        total_spend: 1746.4,
        total_budget: 5000,
        budget_consumed_pct: 34.9,
        projected_overspend: 0,
        days_in_month: 31,
        unregistered: { agents: [] },
      }),
    });
  });

  await page.goto("/cost-dashboard");

  await expect(page.getByText("US$ 1,746", { exact: true })).toBeVisible();
  await expect(page.getByText("US$ 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("US$ 1,746.40")).toHaveCount(0);
});
