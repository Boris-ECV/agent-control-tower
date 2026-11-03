import { expect, test } from "@playwright/test";

// Covers SDLCCT-66's 4 Gherkin scenarios for the 跨 Agent 期間比較 table's
// Delta column (frontend/components/cost-overview/period-comparison-section.tsx).
// No e2e spec previously existed for this table; added as the minimal
// coverage for newly-visible UI (the "新增顯著支出" badge).

function mockPeriodComparison(
  agents: Array<{
    key: string;
    display: string;
    current_cost: number;
    previous_cost: number;
    delta: number;
    delta_pct: number | null;
  }>,
) {
  return {
    current_period: { start: "2026-10-01", end: "2026-10-28" },
    previous_period: { start: "2026-09-01", end: "2026-09-28" },
    agents,
  };
}

test("previous=US$500, current=US$750: shows +US$ 250（50.0%）without the badge", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "agent-1",
            display: "sales-copilot",
            current_cost: 750,
            previous_cost: 500,
            delta: 250,
            delta_pct: 50.0,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  // SDLCCT-83: 增加金額與漲幅拆成兩個獨立欄位。
  await expect(page.getByText("+US$ 250.00", { exact: true })).toBeVisible();
  await expect(page.getByText("（50.0%）", { exact: true })).toBeVisible();
  await expect(page.getByText("新增顯著支出")).toHaveCount(0);
});

test("previous=US$1 (<US$10), current=US$639: shows +US$ 638 with the 新增顯著支出 badge, no percentage", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "agent-1",
            display: "sales-copilot",
            current_cost: 639,
            previous_cost: 1,
            delta: 638,
            delta_pct: 63800.0,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  await expect(page.getByText("+US$ 638.00", { exact: true })).toBeVisible();
  await expect(page.getByText("新增顯著支出")).toBeVisible();
  await expect(page.getByText(/%）/)).toHaveCount(0);
});

test("previous=US$0, current=US$120: shows +US$ 120 with the 新增顯著支出 badge, no percentage", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "agent-1",
            display: "finance-assistant",
            current_cost: 120,
            previous_cost: 0,
            delta: 120,
            delta_pct: null,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  await expect(page.getByText("+US$ 120.00", { exact: true })).toBeVisible();
  await expect(page.getByText("新增顯著支出")).toBeVisible();
  await expect(page.getByText(/%）/)).toHaveCount(0);
});

test("threshold boundary: previous=US$10, current=US$20: shows +US$ 10.00（100.0%）without the badge", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "agent-1",
            display: "ops-bot",
            current_cost: 20,
            previous_cost: 10,
            delta: 10,
            delta_pct: 100.0,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  await expect(page.getByText("+US$ 10.00", { exact: true })).toBeVisible();
  await expect(page.getByText("（100.0%）", { exact: true })).toBeVisible();
  await expect(page.getByText("新增顯著支出")).toHaveCount(0);
});

// AC "列可點擊進入詳情頁": clicking a row (or Tab+Enter) navigates to that
// agent's detail page. Follows the same pattern as e2e/agents.spec.ts's
// row-click assertion for the Agent 清單 table.
test("SDLCCT-83: clicking a period-comparison row navigates to that agent's detail page", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "sales-copilot",
            display: "sales-copilot",
            current_cost: 750,
            previous_cost: 500,
            delta: 250,
            delta_pct: 50.0,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  const row = page.getByRole("button", { name: "sales-copilot" });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});

// Keyboard path: Tab to focus the row, then Enter activates it the same
// way a click does.
test("SDLCCT-83: Tab+Enter on a period-comparison row navigates to that agent's detail page", async ({
  page,
}) => {
  await page.route("**/api/cost-overview/period-comparison", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        mockPeriodComparison([
          {
            key: "sales-copilot",
            display: "sales-copilot",
            current_cost: 750,
            previous_cost: 500,
            delta: 250,
            delta_pct: 50.0,
          },
        ]),
      ),
    });
  });

  await page.goto("/cost-dashboard");

  const row = page.getByRole("button", { name: "sales-copilot" });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});
