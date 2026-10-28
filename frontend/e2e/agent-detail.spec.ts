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

  // AC4: top-cost trace list section visible. metadata.user_id is not one of
  // the 4 known fields (SDLCCT-74), so it sits collapsed behind "更多" until
  // expanded.
  await expect(page.getByText("最貴執行清單")).toBeVisible();
  await expect(page.getByText("trace-001")).toBeVisible();
  await expect(page.getByText("trace-002")).toBeVisible();
  const populatedRow1 = page.locator("tr", { hasText: "trace-001" });
  await expect(populatedRow1.getByText("user_id: u1")).toHaveCount(0);
  await populatedRow1.getByRole("button", { name: "更多" }).click();
  await expect(populatedRow1.getByText("user_id: u1")).toBeVisible();
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

test("SDLCCT-74 AC1/AC2: top_traces metadata renders the 4 known fields as labelled chips, with other fields collapsed behind 更多/收合", async ({
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
          {
            id: "trace-001",
            total_estimated_cost: 999,
            metadata: {
              plant: "P1",
              deployed_version: "v2.1",
              dept: "Sales",
              trigger: "manual",
              providers: "openai",
              cost_center: "CC-01",
            },
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.locator("tr", { hasText: "trace-001" });
  // AC1: the 4 known fields show as labelled chips, always visible.
  await expect(row.getByText("廠別: P1")).toBeVisible();
  await expect(row.getByText("版本: v2.1")).toBeVisible();
  await expect(row.getByText("部門: Sales")).toBeVisible();
  await expect(row.getByText("觸發方式: manual")).toBeVisible();

  // AC2: the remaining fields (providers/cost_center) are collapsed by
  // default behind "更多", and not shown until expanded.
  await expect(row.getByText("providers: openai")).toHaveCount(0);
  await expect(row.getByText("cost_center: CC-01")).toHaveCount(0);
  const moreButton = row.getByRole("button", { name: "更多" });
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect(row.getByText("providers: openai")).toBeVisible();
  await expect(row.getByText("cost_center: CC-01")).toBeVisible();

  // Clicking again (now labelled 收合) collapses it back.
  const collapseButton = row.getByRole("button", { name: "收合" });
  await collapseButton.click();
  await expect(row.getByText("providers: openai")).toHaveCount(0);
  await expect(row.getByText("cost_center: CC-01")).toHaveCount(0);
});

test("SDLCCT-74 AC3: a missing known field (dept) renders no blank/undefined chip, and is absent from the collapsed section too", async ({
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
          {
            id: "trace-001",
            total_estimated_cost: 999,
            metadata: { plant: "P1", deployed_version: "v2.1", trigger: "manual" },
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.locator("tr", { hasText: "trace-001" });
  await expect(row.getByText("廠別: P1")).toBeVisible();
  await expect(row.getByText("版本: v2.1")).toBeVisible();
  await expect(row.getByText("觸發方式: manual")).toBeVisible();
  // dept is missing: no blank/undefined/null text, and no "部門:" label at all.
  await expect(row.getByText("部門", { exact: false })).toHaveCount(0);
  await expect(row.getByText("undefined", { exact: false })).toHaveCount(0);
  await expect(row.getByText("null", { exact: false })).toHaveCount(0);
  // All 4 known fields present except dept -> no "other fields" remain, so
  // no expand control should render at all.
  await expect(row.getByRole("button", { name: "更多" })).toHaveCount(0);
});

test("SDLCCT-74 AC4: null metadata keeps the existing — behavior with no chips or expand control", async ({
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

  const nullRow = page.locator("tr", { hasText: "trace-002" });
  await expect(nullRow.getByText("—", { exact: true })).toBeVisible();
  await expect(nullRow.getByRole("button", { name: "更多" })).toHaveCount(0);
  await expect(nullRow.getByRole("button", { name: "收合" })).toHaveCount(0);
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
