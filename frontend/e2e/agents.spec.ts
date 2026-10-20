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

test("sidebar Agent 清單項目在導覽後顯示 active 樣式狀態", async ({ page }) => {
  await page.goto("/cost-dashboard");

  const agentListLink = page.getByRole("link", { name: "Agent 清單" });
  const costDashboardLink = page.getByRole("link", { name: "成本儀表板" });

  // Before navigating to /agents, the Agent 清單 item must not be marked
  // active (components/ui/sidebar.tsx's SidebarMenuButton only renders the
  // data-active attribute at all when isActive is true, which app-sidebar.tsx
  // derives from usePathname() === item.href; when false the attribute is
  // simply absent from the DOM, and when true it's present as an empty
  // boolean attribute, i.e. `data-active=""`).
  await expect(agentListLink).not.toHaveAttribute("data-active");
  await expect(costDashboardLink).toHaveAttribute("data-active");

  await agentListLink.click();
  await expect(page).toHaveURL(/\/agents$/);

  // After navigating, the clicked item becomes active and the
  // previously-active item (Cost Dashboard) becomes inactive.
  await expect(agentListLink).toHaveAttribute("data-active");
  await expect(costDashboardLink).not.toHaveAttribute("data-active");
});

test("AC1: clicking an agent row navigates to that agent's detail page", async ({
  page,
}) => {
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: "alice",
            budget: 1000,
            current_period_spend: 500,
            budget_consumed_pct: 50,
            has_governance_gap: false,
            registered: true,
            trend: [{ date: "2026-10-18", value: 100 }],
          },
        ],
      }),
    });
  });

  await page.goto("/agents");

  // Desktop table row -- scoped to <table> since the mobile <ul> card list
  // for the same agent is also present in the DOM (hidden via CSS, not
  // removed), which would otherwise make the row locator ambiguous.
  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toHaveAttribute("aria-label", "Sales Copilot");

  await firstRow.click();

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});
