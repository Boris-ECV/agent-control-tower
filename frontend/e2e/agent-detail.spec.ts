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

  // The sticky header no longer duplicates the sidebar's product title
  // (SDLCCT-68); the sidebar nav (components/layout/app-sidebar.tsx) remains
  // the sole place "Agent Control Tower" is rendered.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();
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

test("AC2: a null point in the middle of a version's series breaks the line into separate segments, not 0 or a connected line", async ({
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
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  // v1 has a null point in the middle of its 3-point series, so it must
  // render as two disconnected <polyline> segments (one point before the
  // null, one point after) rather than a single line spanning the gap or
  // treating the null as 0. v2 has no null point, so it renders as a single
  // <polyline> covering all 3 points. Total polylines across both series: 3.
  const polylines = page.locator("svg polyline");
  await expect(polylines).toHaveCount(3);

  // Each segment for a null-adjacent single point still renders as a
  // <polyline> with exactly one coordinate pair (no line drawn to/from the
  // missing point).
  const pointCounts = await polylines.evaluateAll((els) =>
    els.map((el) => (el.getAttribute("points") ?? "").trim().split(/\s+/).length),
  );
  // v1 contributes two single-point segments (1,1) and v2 contributes one
  // 3-point segment (3); exact ordering of <g> children isn't asserted, only
  // that there are two length-1 segments and one length-3 segment present.
  expect(pointCounts.filter((n) => n === 1)).toHaveLength(2);
  expect(pointCounts.filter((n) => n === 3)).toHaveLength(1);

  // The legend lists exactly one entry per version, matching the series count.
  await expect(page.locator("ul li", { hasText: "v1" })).toHaveCount(1);
  await expect(page.locator("ul li", { hasText: "v2" })).toHaveCount(1);
});

test("SDLCCT-73: chart shows exactly two Y-axis amount labels (max and min) when values differ", async ({
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
              { date: "2026-10-15", value: 400 },
            ],
          },
          {
            version: "v2",
            points: [
              { date: "2026-10-14", value: 50 },
              { date: "2026-10-15", value: 200 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const labels = page.locator("svg text");
  await expect(labels).toHaveCount(2);
  await expect(page.locator("svg text", { hasText: "US$ 400" })).toHaveCount(1);
  await expect(page.locator("svg text", { hasText: "US$ 50" })).toHaveCount(1);

  // Both labels sit in the left padding area (x < CHART_PADDING = 24).
  const xs = await labels.evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute("x"))),
  );
  for (const x of xs) {
    expect(x).toBeLessThan(24);
  }
});

test("SDLCCT-73: chart shows exactly one Y-axis amount label when all values are equal", async ({
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
              { date: "2026-10-15", value: 100 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.locator("svg text")).toHaveCount(1);
  await expect(page.locator("svg text", { hasText: "US$ 100" })).toHaveCount(1);
});

test("SDLCCT-73: chart shows no Y-axis amount label and never fabricates US$ 0 when every value is null", async ({
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
              { date: "2026-10-14", value: null },
              { date: "2026-10-15", value: null },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.locator("svg text")).toHaveCount(0);
  await expect(page.locator("svg", { hasText: "US$ 0" })).toHaveCount(0);
});

test("AC3: model-breakdown table shows — (not 0) for a null cost", async ({
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
        model_cost_breakdown: [
          { model: "gpt-4o", cost: 300 },
          { model: "gpt-4o-mini", cost: null },
        ],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const nullRow = page.locator("tr", { hasText: "gpt-4o-mini" });
  await expect(nullRow.getByText("—", { exact: true })).toBeVisible();
  await expect(nullRow.getByText("0", { exact: true })).toHaveCount(0);

  const populatedRow = page.locator("tr", { hasText: "gpt-4o" }).filter({
    hasNotText: "gpt-4o-mini",
  });
  await expect(populatedRow.getByText("—")).toHaveCount(0);
});

test("AC4: top_traces metadata column renders a populated dict as JSON and a null metadata as —", async ({
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
          { id: "trace-002", total_estimated_cost: 500, metadata: null },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const populatedRow = page.locator("tr", { hasText: "trace-001" });
  await expect(populatedRow.getByText('{"user_id":"u1"}')).toBeVisible();

  const nullRow = page.locator("tr", { hasText: "trace-002" });
  await expect(nullRow.getByText("—", { exact: true })).toBeVisible();
});

test("mobile viewport: version series, model breakdown, and top traces sections all remain visible with no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

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

  await expect(page.getByText("版本成本時間序列")).toBeVisible();
  await expect(page.getByText("模型成本分解")).toBeVisible();
  await expect(page.getByText("最貴執行清單")).toBeVisible();
  await expect(page.getByText("v1").first()).toBeVisible();
  await expect(page.getByText("gpt-4o", { exact: true })).toBeVisible();
  await expect(page.getByText("trace-001")).toBeVisible();

  // Structural overflow check (no hardcoded pixel widths): the page's
  // scrollable content must not exceed the viewport's own client width.
  const overflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsHorizontally).toBe(false);
});

test("SDLCCT-56: top_traces rows are visually clickable and clicking navigates to the trace's execution detail screen", async ({
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
  await page.route(`**/api/agents/${MOCK_KEY}/traces/trace-001/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: MOCK_KEY, trace_id: "trace-001", spans: [] }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.getByText("trace-001").locator("xpath=ancestor::tr");
  await expect(row).toHaveClass(/cursor-pointer/);

  // SDLCCT-56: clicking a row now navigates to the execution detail screen
  // (this replaces SDLCCT-48's original "no navigation" assertion, which
  // was explicitly flagged in docs/design/SDLCCT-56.md as expected to be
  // superseded by this ticket's in-scope new interaction).
  await row.click();
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/trace-001`);
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

test("SDLCCT-64: header back link navigates to /agents via click, Enter, and Space, and stays usable under loading/error", async ({
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
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const backLink = page.getByRole("link", { name: "返回 Agent 清單" });
  await expect(backLink).toHaveAttribute("href", "/agents");
  await backLink.click();
  await expect(page).toHaveURL("/agents");

  // Keyboard: focus the back link directly, then Enter (native <a> behavior).
  await page.goto(`/agents/${MOCK_KEY}`);
  const backLinkForEnter = page.getByRole("link", { name: "返回 Agent 清單" });
  await backLinkForEnter.focus();
  await expect(backLinkForEnter).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/agents");

  // Keyboard: focus the back link directly, then Space (manual onKeyDown handler).
  await page.goto(`/agents/${MOCK_KEY}`);
  const backLinkForSpace = page.getByRole("link", { name: "返回 Agent 清單" });
  await backLinkForSpace.focus();
  await expect(backLinkForSpace).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page).toHaveURL("/agents");
});

test("SDLCCT-64: header back link remains visible and usable while the cost-breakdown request is pending", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async () => {
    // Never fulfill: simulates an indefinitely pending request so the page
    // stays in its loading state.
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const backLink = page.getByRole("link", { name: "返回 Agent 清單" });
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute("href", "/agents");
  await backLink.click();
  await expect(page).toHaveURL("/agents");
});

test("SDLCCT-64: header back link remains visible and usable when the cost-breakdown request errors", async ({
  page,
}) => {
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Opik query failed" } }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const backLink = page.getByRole("link", { name: "返回 Agent 清單" });
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute("href", "/agents");
  await backLink.click();
  await expect(page).toHaveURL("/agents");
});
