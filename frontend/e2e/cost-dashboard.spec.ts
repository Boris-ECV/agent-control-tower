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
