import { expect, test } from "@playwright/test";

const KEY = "sales-copilot";
const TRACE_ID = "trc_123";

test.beforeEach(async ({ page }) => {
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
        top_traces: [],
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
});

test("Agent detail page highlights Agent 清單", async ({ page }) => {
  await page.goto(`/agents/${KEY}`);
  await expect(page.getByRole("link", { name: "Agent 清單" })).toHaveAttribute("data-active");
  await expect(page.getByRole("link", { name: "成本儀表板" })).not.toHaveAttribute("data-active");
});

test("Trace detail page highlights Agent 清單", async ({ page }) => {
  await page.goto(`/agents/${KEY}/traces/${TRACE_ID}`);
  await expect(page.getByRole("link", { name: "Agent 清單" })).toHaveAttribute("data-active");
  await expect(page.getByRole("link", { name: "成本儀表板" })).not.toHaveAttribute("data-active");
});

for (const path of ["/cost-dashboard", "/anomalies", "/settings/system"]) {
  test(`${path} does not highlight Agent 清單`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Agent 清單" })).not.toHaveAttribute("data-active");
  });
}

test("clicking Agent 清單 from detail navigates to /agents and stays active", async ({ page }) => {
  await page.goto(`/agents/${KEY}`);
  const link = page.getByRole("link", { name: "Agent 清單" });
  await link.click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(link).toHaveAttribute("data-active");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Sheet sidebar highlights Agent 清單 on detail page", async ({ page }) => {
    await page.goto(`/agents/${KEY}`);
    await page.getByRole("button", { name: /sidebar/i }).first().click();
    const sheet = page.locator('[data-mobile="true"]');
    await expect(sheet.getByRole("link", { name: "Agent 清單" })).toHaveAttribute("data-active");
  });
});
