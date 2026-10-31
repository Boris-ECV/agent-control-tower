import { expect, test, type Page } from "@playwright/test";

const KEY = "sales-copilot";
const TRACE_ID = "trc_123";
const ACTIVE = '[data-sidebar="menu-button"][data-active]:not([data-active="false"])';

async function mockApis(page: Page) {
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: KEY,
        display: "Sales Copilot",
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: TRACE_ID, total_estimated_cost: 999, metadata: null }],
      }),
    });
  });
  await page.route(`**/api/agents/${KEY}/traces/${TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: KEY, trace_id: TRACE_ID, spans: [] }),
    });
  });
}

async function expectOnlyActive(scope: ReturnType<Page["locator"]>, label: string) {
  const active = scope.locator(ACTIVE);
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(label);
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
});

test("Scenario 1: agent detail -> only Agent 清單 active", async ({ page }) => {
  await page.goto(`/agents/${KEY}`);
  await expectOnlyActive(page.locator("body"), "Agent 清單");
});

test("Scenario 2: trace detail -> only Agent 清單 active", async ({ page }) => {
  await page.goto(`/agents/${KEY}/traces/${TRACE_ID}`);
  await expectOnlyActive(page.locator("body"), "Agent 清單");
});

test("Scenario 3: cost dashboard -> only 成本儀表板 active, not Agent 清單", async ({ page }) => {
  await page.goto("/cost-dashboard");
  await expectOnlyActive(page.locator("body"), "成本儀表板");
  await expect(
    page.locator('[data-sidebar="menu-button"]', { hasText: "Agent 清單" }),
  ).not.toHaveAttribute("data-active", "true");
});

test("navigating from agent detail to trace page keeps Agent 清單 active", async ({ page }) => {
  await page.goto(`/agents/${KEY}`);
  await expectOnlyActive(page.locator("body"), "Agent 清單");
  await page.getByText(TRACE_ID).locator("xpath=ancestor::tr").click();
  await expect(page).toHaveURL(`/agents/${KEY}/traces/${TRACE_ID}`);
  await expectOnlyActive(page.locator("body"), "Agent 清單");
});

test("keyboard Tab/Enter on Agent 清單 link navigates to /agents", async ({ page }) => {
  await page.goto(`/agents/${KEY}`);
  const link = page.getByRole("link", { name: "Agent 清單", exact: true });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agents$/);
  await expectOnlyActive(page.locator("body"), "Agent 清單");
});

test("Tab order reaches Agent 清單 link then Enter navigates", async ({ page }) => {
  await page.goto("/cost-dashboard");
  const link = page.getByRole("link", { name: "Agent 清單", exact: true });
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await link.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agents$/);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Sheet sidebar: exactly one active item, Agent 清單, on trace page", async ({ page }) => {
    await page.goto(`/agents/${KEY}/traces/${TRACE_ID}`);
    await page.getByRole("button", { name: /sidebar/i }).first().click();
    const sheet = page.locator('[data-mobile="true"]');
    await expect(sheet).toBeVisible();
    await expectOnlyActive(sheet, "Agent 清單");
  });
});
