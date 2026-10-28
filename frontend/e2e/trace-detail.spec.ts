import { expect, test } from "@playwright/test";

const MOCK_KEY = "sales-copilot";
const MOCK_TRACE_ID = "trc_123";

test("Scenario 1: clicking a top_traces row navigates to /agents/[key]/traces/[traceId]", async ({
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
          { id: MOCK_TRACE_ID, total_estimated_cost: 999, metadata: null },
        ],
      }),
    });
  });
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: MOCK_KEY, trace_id: MOCK_TRACE_ID, spans: [] }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);
  const row = page.getByText(MOCK_TRACE_ID).locator("xpath=ancestor::tr");
  await row.click();

  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);
});

test("Scenario 2: 200 with a non-empty span tree renders name/type/time for each span with visible parent-child indentation", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        trace_id: MOCK_TRACE_ID,
        spans: [
          {
            id: "spn_1",
            parent_span_id: null,
            name: "root-chain",
            type: "general",
            start_time: "2026-10-01T00:00:00Z",
            end_time: "2026-10-01T00:00:05Z",
            children: [
              {
                id: "spn_2",
                parent_span_id: "spn_1",
                name: "summarize",
                type: "llm",
                start_time: "2026-10-01T00:00:06Z",
                end_time: "2026-10-01T00:00:08Z",
                children: [],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  // SDLCCT-68: the sticky header no longer duplicates the sidebar's product
  // title; the sidebar nav (components/layout/app-sidebar.tsx) remains the
  // sole place "Agent Control Tower" is rendered, including on this
  // trace-detail page explicitly named in the ticket's acceptance criteria.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();

  await expect(page.getByText("root-chain")).toBeVisible();
  await expect(page.getByText("general")).toBeVisible();
  await expect(page.getByText("summarize")).toBeVisible();
  await expect(page.getByText("llm")).toBeVisible();

  const parentRow = page.getByText("root-chain").locator("xpath=ancestor::div[1]");
  const childRow = page.getByText("summarize").locator("xpath=ancestor::div[1]");
  const parentPadding = await parentRow.evaluate(
    (el) => window.getComputedStyle(el).paddingLeft,
  );
  const childPadding = await childRow.evaluate((el) => window.getComputedStyle(el).paddingLeft);
  expect(parseFloat(childPadding)).toBeGreaterThan(parseFloat(parentPadding));
});

test("Scenario 3: 2+ same-name sibling spans collapse into one row with a × N badge, expandable to individual instances", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        trace_id: MOCK_TRACE_ID,
        spans: [
          {
            id: "spn_1",
            parent_span_id: null,
            name: "root-chain",
            type: "general",
            start_time: "2026-10-01T00:00:00Z",
            end_time: "2026-10-01T00:00:05Z",
            children: [
              {
                id: "spn_2",
                parent_span_id: "spn_1",
                name: "search-tool",
                type: "tool",
                start_time: "2026-10-01T00:00:01Z",
                end_time: "2026-10-01T00:00:02Z",
                children: [],
              },
              {
                id: "spn_3",
                parent_span_id: "spn_1",
                name: "search-tool",
                type: "tool",
                start_time: "2026-10-01T00:00:02Z",
                end_time: "2026-10-01T00:00:03Z",
                children: [],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  // Collapsed: one "search-tool" row with a × 2 badge, not two separate rows.
  await expect(page.getByText("search-tool")).toHaveCount(1);
  await expect(page.getByText("× 2")).toBeVisible();

  // Expand to see individual instances (each with its own time).
  await page.getByRole("button", { expanded: false, name: /search-tool/ }).click();
  await expect(page.getByText("search-tool")).toHaveCount(3); // group label + 2 expanded instances
});

test("Scenario 4: 200 with spans: [] shows an explicit empty-state message, not a blank page", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: MOCK_KEY, trace_id: MOCK_TRACE_ID, spans: [] }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  await expect(page.getByText("查無資料")).toBeVisible();
});

test("Scenario 5: backend 404 shows the existing ErrorCard, never blank", async ({ page }) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Agent '${MOCK_KEY}' not found` }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  await expect(page.getByText(/無法載入/)).toBeVisible();
  await expect(page.getByText(/404/)).toBeVisible();
});

test("Scenario 5: backend 502 shows the existing ErrorCard, never blank", async ({ page }) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "trace query failed" } }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  await expect(page.getByText(/無法載入/)).toBeVisible();
  await expect(page.getByText(/502/)).toBeVisible();
});

test("Scenario 6: no screen text contains 'Opik' or any other underlying observability backend brand name", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        trace_id: MOCK_TRACE_ID,
        spans: [
          {
            id: "spn_1",
            parent_span_id: null,
            name: "root-chain",
            type: "general",
            start_time: "2026-10-01T00:00:00Z",
            end_time: "2026-10-01T00:00:05Z",
            children: [],
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);
  await expect(page.getByText("root-chain")).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(bodyText.toLowerCase()).not.toContain("opik");
});
