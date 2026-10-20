import { expect, test } from "@playwright/test";

const MOCK_KEY = "sales-copilot";

test("agent detail page loads and shows version series, model breakdown, and top traces (AC2/AC3/AC4)", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "Sales Copilot",
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [
          {
            version: "v1",
            points: [
              { date: "2026-10-14", value: 100 },
              { date: "2026-10-15", value: null },
              { date: "2026-10-16", value: 150 },
            ],
          },
          {
            version: "v2",
            points: [
              { date: "2026-10-14", value: 50 },
              { date: "2026-10-15", value: 60 },
              { date: "2026-10-16", value: 400 },
            ],
          },
        ],
        model_cost_breakdown: [
          { model: "gpt-4o", cost: 300 },
          { model: "gpt-4o-mini", cost: null },
        ],
        top_traces: [
          { id: "trace-001", total_estimated_cost: 999, metadata: { user_id: "u1" } },
          { id: "trace-002", total_estimated_cost: 500, metadata: null },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales Copilot" })).toBeVisible();

  // AC2: version-split cost series section visible.
  await expect(page.getByText("版本成本時間序列")).toBeVisible();
  await expect(page.getByText("v1").first()).toBeVisible();
  await expect(page.getByText("v2").first()).toBeVisible();
  // null point renders as "—" in the detail table, not 0.
  await expect(page.getByText("—").first()).toBeVisible();

  // AC3: model-split cost breakdown section visible.
  await expect(page.getByText("模型成本分解")).toBeVisible();
  await expect(page.getByText("gpt-4o", { exact: true })).toBeVisible();
  await expect(page.getByText("gpt-4o-mini")).toBeVisible();

  // AC4: top-cost trace list section visible, metadata rendered as JSON.
  await expect(page.getByText("最貴執行清單")).toBeVisible();
  await expect(page.getByText("trace-001")).toBeVisible();
  await expect(page.getByText("trace-002")).toBeVisible();
  await expect(page.getByText('{"user_id":"u1"}')).toBeVisible();
});

test("AC4: top_traces rows are visually clickable but clicking triggers no navigation or new network request", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "Sales Copilot",
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [
          { id: "trace-001", total_estimated_cost: 999, metadata: { user_id: "u1" } },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.getByText("trace-001").locator("xpath=ancestor::tr");
  await expect(row).toHaveClass(/cursor-pointer/);

  let requestCount = 0;
  page.on("request", () => {
    requestCount += 1;
  });

  const urlBefore = page.url();
  // Let any in-flight requests settle before counting the baseline.
  await page.waitForTimeout(200);
  requestCount = 0;

  await row.click();
  await page.waitForTimeout(300);

  expect(page.url()).toBe(urlBefore);
  expect(requestCount).toBe(0);
});

test("AC5: backend 404 shows an explicit error card, never blank", async ({ page }) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Agent '${MOCK_KEY}' not found` }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.getByText(/無法載入/)).toBeVisible();
  await expect(page.getByText(/404/)).toBeVisible();
  // None of the three sections render when the whole request fails.
  await expect(page.getByText("版本成本時間序列")).toHaveCount(0);
  await expect(page.getByText("模型成本分解")).toHaveCount(0);
  await expect(page.getByText("最貴執行清單")).toHaveCount(0);
});

test("AC5: backend 502 shows an explicit error card, never blank", async ({ page }) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Opik query failed" } }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.getByText(/無法載入/)).toBeVisible();
  await expect(page.getByText(/502/)).toBeVisible();
  await expect(page.getByText("版本成本時間序列")).toHaveCount(0);
  await expect(page.getByText("模型成本分解")).toHaveCount(0);
  await expect(page.getByText("最貴執行清單")).toHaveCount(0);
});
