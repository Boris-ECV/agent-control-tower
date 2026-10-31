import { expect, test, type Locator, type Page } from "@playwright/test";

// SDLCCT-94 acceptance: table amounts are `US$ 1,234.56`, right-aligned with
// tabular-nums; summary-card amounts are integers `US$ 1,746`.

const TABLE_RE = /^[+-]?US\$ [\d,]+\.\d{2}$/;
const CARD_RE = /^US\$ [\d,]+$/;

async function json(page: Page, glob: string, body: unknown) {
  await page.route(glob, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

async function expectAmountCells(cells: Locator, min: number) {
  const n = await cells.count();
  expect(n).toBeGreaterThanOrEqual(min);
  for (let i = 0; i < n; i++) {
    const cell = cells.nth(i);
    const text = ((await cell.innerText()) ?? "").trim();
    // Delta cells may carry a trailing percent / badge; compare the amount.
    const amount = text.match(/[+-]?US\$ [\d,]+(?:\.\d+)?/)?.[0] ?? text;
    expect(amount).toMatch(TABLE_RE);
    const s = await cell.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { align: cs.textAlign, num: cs.fontVariantNumeric };
    });
    expect(s.align).toBe("right");
    expect(s.num).toContain("tabular-nums");
  }
}

test("agents page: table amounts are 2-decimal, right-aligned, tabular-nums", async ({ page }) => {
  await json(page, "**/api/agents", {
    anchor_date: "2026-10-20",
    period_start: "2026-10-01",
    agents: [
      {
        key: "a1", display: "Agent One", dept: "Sales", owner: "alice",
        budget: 12345.6, current_period_spend: 1234.5,
        budget_consumed_pct: 10, has_governance_gap: false, registered: true,
        trend: [{ date: "2026-10-18", value: 100 }],
      },
    ],
  });
  await page.goto("/agents");
  const cells = page.locator("table tbody td", { hasText: /US\$/ });
  await expect(cells.first()).toBeVisible();
  await expectAmountCells(cells, 2);
  await expect(page.locator("table tbody td", { hasText: "US$ 12,345.60" })).toBeVisible();
  await expect(page.locator("table tbody td", { hasText: "US$ 1,234.50" })).toBeVisible();
});

test("cost dashboard: cards are integers; unregistered list and period table are 2-decimal", async ({ page }) => {
  await json(page, "**/api/cost-overview/summary", {
    anchor_date: "2026-10-28",
    total_spend: 1746.4,
    total_budget: 5000,
    budget_consumed_pct: 34.9,
    projected_overspend: 1234.56,
    days_in_month: 31,
    unregistered: { agents: [{ key: "ghost", display: "ghost-bot", spend: 2345.678 }] },
  });
  await json(page, "**/api/cost-overview/period-comparison", {
    current_period: { start: "2026-10-01", end: "2026-10-28" },
    previous_period: { start: "2026-09-01", end: "2026-09-28" },
    agents: [
      { key: "p1", display: "grower", current_cost: 1750.5, previous_cost: 1500.25, delta: 250.25, delta_pct: 16.7 },
      { key: "p2", display: "shrinker", current_cost: 100, previous_cost: 1334.567, delta: -1234.567, delta_pct: -92.5 },
    ],
  });
  await page.goto("/cost-dashboard");

  for (const t of ["US$ 1,746", "US$ 5,000", "US$ 1,235"]) {
    await expect(page.getByText(t, { exact: true })).toBeVisible();
    expect(t).toMatch(CARD_RE);
  }

  const ghost = page.locator("li", { hasText: "ghost-bot" }).locator("span.tabular-nums");
  await expect(ghost).toHaveText("US$ 2,345.68");
  await expectAmountCells(ghost, 1);

  const periodRows = page.locator("tr", { hasText: /grower|shrinker/ });
  await expect(periodRows).toHaveCount(2);
  await expectAmountCells(periodRows.locator("td").filter({ hasText: /US\$/ }), 6);
  await expect(page.getByText("+US$ 250.25", { exact: false })).toBeVisible();
  await expect(page.getByText("-US$ 1,234.57", { exact: false })).toBeVisible();
});

test("agent detail: model, top-trace and version fallback tables are 2-decimal, right-aligned", async ({ page }) => {
  await json(page, "**/api/agents/sales-copilot/cost-breakdown", {
    key: "sales-copilot",
    display: "Sales Copilot",
    anchor_date: "2026-10-20",
    period_start: "2026-10-01",
    version_cost_series: [
      {
        version: "v1",
        points: [
          { date: "2026-10-14", value: 1234.5 },
          { date: "2026-10-15", value: null },
          { date: "2026-10-16", value: 150 },
        ],
      },
    ],
    model_cost_breakdown: [{ model: "gpt-4o", cost: 1300.126 }],
    top_traces: [{ id: "trace-001", total_estimated_cost: 999, metadata: null }],
  });
  await page.goto("/agents/sales-copilot");
  await expect(page.getByText("trace-001")).toBeVisible();

  const amountCells = page
    .locator("table tbody td")
    .filter({ hasText: /^\s*US\$/ });
  await expectAmountCells(amountCells, 4);
  for (const t of ["US$ 1,300.13", "US$ 999.00", "US$ 1,234.50", "US$ 150.00"]) {
    await expect(page.locator("table tbody td", { hasText: t }).first()).toBeAttached();
  }
});
