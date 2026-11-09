import { expect, test } from "@playwright/test";

const MOCK_KEY = "sales-copilot";
const MOCK_TRACE_ID = "trc_123";

test("SDLCCT-118 Scenario 1/2: waterfall shows a gridline every 2 elapsed seconds and each span's duration, colored by type", async ({
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
            start_time: "2026-10-01T08:00:00Z",
            end_time: "2026-10-01T08:00:08Z",
            children: [
              {
                id: "spn_2",
                parent_span_id: "spn_1",
                name: "search-tool",
                type: "tool",
                start_time: "2026-10-01T08:00:00Z",
                end_time: "2026-10-01T08:00:03Z",
                children: [],
              },
              {
                id: "spn_3",
                parent_span_id: "spn_1",
                name: "summarize",
                type: "llm",
                start_time: "2026-10-01T08:00:03Z",
                end_time: "2026-10-01T08:00:07Z",
                children: [],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  await expect(page.getByText("Span 耗時時間軸")).toBeVisible();

  const svg = page.locator("svg[aria-label='Span 耗時時間軸']");
  await expect(svg).toBeVisible();

  // 0..8s elapsed => gridlines at 0,2,4,6,8s (5 total).
  await expect(svg.locator("[data-gridline]")).toHaveCount(5);

  await expect(svg.getByText("8.0s")).toBeVisible();
  await expect(svg.getByText("3.0s")).toBeVisible();
  await expect(svg.getByText("4.0s")).toBeVisible();

  const generalRect = svg.locator('[data-span-row="spn_1"] rect');
  const toolRect = svg.locator('[data-span-row="spn_2"] rect');
  const llmRect = svg.locator('[data-span-row="spn_3"] rect');
  await expect(generalRect).toHaveClass(/fill-gray-400/);
  await expect(toolRect).toHaveClass(/fill-cyan-700/);
  await expect(llmRect).toHaveClass(/fill-purple-700/);
});

test("SDLCCT-118 Scenario 3: a span with a null start_time is omitted from the waterfall but still shown in the tree list", async ({
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
            start_time: "2026-10-01T08:00:00Z",
            end_time: "2026-10-01T08:00:08Z",
            children: [
              {
                id: "spn_2",
                parent_span_id: "spn_1",
                name: "cleanup-step",
                type: "general",
                start_time: null,
                end_time: null,
                children: [],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}/traces/${MOCK_TRACE_ID}`);

  // Still in the tree list.
  await expect(page.getByText("cleanup-step")).toBeVisible();

  // Not a row in the waterfall svg.
  const svg = page.locator("svg[aria-label='Span 耗時時間軸']");
  await expect(svg.locator('[data-span-row="spn_2"]')).toHaveCount(0);
  await expect(svg.locator('[data-span-row="spn_1"]')).toHaveCount(1);
});

test("SDLCCT-118 Scenario 4: spans: [] shows both the existing 查無資料 text and the waterfall's own empty-state text", async ({
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
  await expect(page.getByText("沒有可顯示的資料")).toBeVisible();
  await expect(page.locator("svg[aria-label='Span 耗時時間軸']")).toHaveCount(0);
});
