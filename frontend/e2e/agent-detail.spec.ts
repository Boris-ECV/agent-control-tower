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

  // SDLCCT-79: with 2 versions (<= 4), the legend is replaced by a direct
  // text label at each line's tail (last non-null point) showing the
  // version name and its formatted value, so each version is still
  // identifiable without the legend. v1's last non-null value is 150 (on
  // 2026-10-16); v2's last non-null value is 400 (on 2026-10-16).
  await expect(
    page.locator('svg g[data-labels="tail"] text', { hasText: "v1 US$ 150" }),
  ).toHaveCount(1);
  await expect(
    page.locator('svg g[data-labels="tail"] text', { hasText: "v2 US$ 400" }),
  ).toHaveCount(1);
  // Scoped to the version-series section: the page also has other <ul><li>
  // lists (e.g. model-breakdown, top-traces) unrelated to this chart's
  // legend, so an unscoped "ul li" locator would count those too.
  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  await expect(versionSection.locator("ul li")).toHaveCount(0);
});

test("SDLCCT-72: date axis always covers a full 7 days (anchor_date-6..anchor_date), even when a version's points cover only part of it", async ({
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
              { date: "2026-10-18", value: 100 },
              { date: "2026-10-19", value: 150 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  // Exactly 7 date <th> columns (plus 1 "version" header column), D-6..D in
  // order, even though v1's points only cover 2 of those 7 days. Scope to
  // the version-series section: the page also has model-breakdown and
  // top-traces tables with their own <thead>.
  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  const headerRow = versionSection.locator("thead tr");
  await expect(headerRow.locator("th")).toHaveCount(8);
  const dateHeaders = await headerRow.locator("th").allTextContents();
  // formatDayColumnHeader renders dates as e.g. "10/14 (三)"; assert the full
  // ordered set of day labels for 2026-10-14..2026-10-20.
  expect(dateHeaders.slice(1)).toEqual([
    "10/14 (三)",
    "10/15 (四)",
    "10/16 (五)",
    "10/17 (六)",
    "10/18 (日)",
    "10/19 (一)",
    "10/20 (二)",
  ]);
});

test("SDLCCT-72: a day with no data point at all for a version shows — (not 0), and the polyline breaks there", async ({
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
              // 2026-10-15 is entirely absent (not value: null).
              { date: "2026-10-16", value: 150 },
              { date: "2026-10-17", value: 160 },
              { date: "2026-10-18", value: 170 },
              { date: "2026-10-19", value: 180 },
              { date: "2026-10-20", value: 190 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.locator("tbody tr", { hasText: "v1" });
  const cells = row.locator("td");
  await expect(cells).toHaveCount(8);
  // cells[0] = version name, cells[2] = 2026-10-15 (the absent date).
  await expect(cells.nth(2)).toHaveText("—");

  // The line breaks at the absent day: 2 polyline segments (1-point + 5-point).
  const polylines = page.locator("svg polyline");
  await expect(polylines).toHaveCount(2);
  const pointCounts = await polylines.evaluateAll((els) =>
    els.map((el) => (el.getAttribute("points") ?? "").trim().split(/\s+/).length),
  );
  expect(pointCounts.sort()).toEqual([1, 5]);
});

test("SDLCCT-72: an existing point with value: null renders identically to an absent date (regression)", async ({
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
              { date: "2026-10-17", value: 160 },
              { date: "2026-10-18", value: 170 },
              { date: "2026-10-19", value: 180 },
              { date: "2026-10-20", value: 190 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.locator("tbody tr", { hasText: "v1" });
  const cells = row.locator("td");
  await expect(cells.nth(2)).toHaveText("—");

  const polylines = page.locator("svg polyline");
  await expect(polylines).toHaveCount(2);
  const pointCounts = await polylines.evaluateAll((els) =>
    els.map((el) => (el.getAttribute("points") ?? "").trim().split(/\s+/).length),
  );
  expect(pointCounts.sort()).toEqual([1, 5]);
});

test("SDLCCT-72: all versions have zero points for the whole week -> table still shows 7 date columns, every cell —, no exception", async ({
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
          { version: "v1", points: [] },
          { version: "v2", points: [] },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  await expect(versionSection.locator("thead th")).toHaveCount(8);
  const rows = versionSection.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    const cells = await row.locator("td").allTextContents();
    for (const text of cells.slice(1)) {
      expect(text).toBe("—");
    }
  }
  await expect(page.locator("svg polyline")).toHaveCount(0);
});

test("SDLCCT-72: entries itself is an empty array -> table still shows 7 date columns, no data rows, no exception", async ({
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

  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  await expect(versionSection.locator("thead th")).toHaveCount(8);
  await expect(versionSection.locator("tbody tr")).toHaveCount(0);
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

  // SDLCCT-78 added a separate always-rendered X-axis date label group;
  // scope to data-axis="y" so this Y-axis-label-count assertion stays
  // unambiguous.
  const labels = page.locator('svg g[data-axis="y"] text');
  await expect(labels).toHaveCount(2);
  // SDLCCT-79 added a tail-label group (also containing "US$ 400" text for
  // v1's endpoint), so scope these amount-text assertions to data-axis="y"
  // specifically rather than any "svg text" to keep counting only the
  // Y-axis labels these tests target.
  await expect(
    page.locator('svg g[data-axis="y"] text', { hasText: "US$ 400" }),
  ).toHaveCount(1);
  // SDLCCT-71: 50 < US$100 threshold, formatCurrency now renders 2 decimals.
  // ("US$ 50" would still coincidentally match "US$ 50.00" via hasText's
  // substring semantics, so assert the exact post-fix string instead.)
  await expect(
    page.locator('svg g[data-axis="y"] text', { hasText: "US$ 50.00" }),
  ).toHaveCount(1);

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

  await expect(page.locator('svg g[data-axis="y"] text')).toHaveCount(1);
  // SDLCCT-79: scope to data-axis="y" — this entry's tail label also
  // renders "v1 US$ 100" text, which would otherwise double-count via an
  // unscoped "svg text" locator.
  await expect(
    page.locator('svg g[data-axis="y"] text', { hasText: "US$ 100" }),
  ).toHaveCount(1);
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

  await expect(page.locator('svg g[data-axis="y"] text')).toHaveCount(0);
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
  // SDLCCT-111: with a single row, 版本/部門/觸發方式 are trivially
  // "all the same" across the (one-row) displayed list, so they fold up
  // into the one-time summary chip row above the table instead of
  // rendering per-row chips; 廠別 is now its own independent column
  // (plain value, no "廠別:" chip label) that never folds.
  await expect(row.getByText("P1", { exact: true })).toBeVisible();
  await expect(row.getByText("廠別: P1")).toHaveCount(0);
  await expect(page.getByText("版本: v2.1")).toBeVisible();
  await expect(page.getByText("部門: Sales")).toBeVisible();
  await expect(page.getByText("觸發方式: manual")).toBeVisible();
  await expect(row.getByText("版本: v2.1")).toHaveCount(0);
  await expect(row.getByText("部門: Sales")).toHaveCount(0);
  await expect(row.getByText("觸發方式: manual")).toHaveCount(0);

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

test("SDLCCT-74 AC2: keyboard activation (Enter) of the 更多 button toggles expand without navigating away from the row", async ({
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
  await page.route(`**/api/agents/${MOCK_KEY}/traces/trace-001/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: MOCK_KEY, trace_id: "trace-001", spans: [] }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.locator("tr", { hasText: "trace-001" });
  const moreButton = row.getByRole("button", { name: "更多" });
  await moreButton.focus();
  await page.keyboard.press("Enter");

  // Expanding via keyboard must not trigger the row's own onClick/onKeyDown
  // navigation (stopPropagation safety check) — we must still be on the
  // agent detail page, with the collapsed fields now visible.
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}`);
  await expect(row.getByText("providers: openai")).toBeVisible();
  await expect(row.getByText("cost_center: CC-01")).toBeVisible();

  // Second Enter press collapses it back and still doesn't navigate.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}`);
  await expect(row.getByText("providers: openai")).toHaveCount(0);
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
  // SDLCCT-111: single row again folds 版本/觸發方式 (both present and
  // trivially consistent) into the summary chip row; 廠別 is its own
  // column, plain value, never folded.
  await expect(row.getByText("P1", { exact: true })).toBeVisible();
  await expect(row.getByText("廠別: P1")).toHaveCount(0);
  await expect(page.getByText("版本: v2.1")).toBeVisible();
  await expect(page.getByText("觸發方式: manual")).toBeVisible();
  // dept is missing from the only row -> always "inconsistent" (decision 3),
  // never folded, and this row has no value for it either, so no chip
  // anywhere: no blank/undefined/null text, and no "部門:" label at all.
  await expect(page.getByText("部門", { exact: false })).toHaveCount(0);
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
  // SDLCCT-110 新增的「執行時間」欄對非合法 UUIDv7 的 trace-002 也顯示
  // em dash，所以泛用的 getByText("—") 現在在這個列裡會比對到兩個元素
  // （執行時間欄 + 中繼資料欄）；用第 4 格（中繼資料欄，Trace
  // ID/執行時間/預估成本/中繼資料/箭頭裝飾欄順序的第 4 個）鎖定本測試真
  // 正要驗證的欄位。
  // SDLCCT-111 新增廠別獨立欄插在中繼資料欄之前，欄序變為 Trace ID／執
  // 行時間／預估成本／廠別／中繼資料／箭頭，中繼資料欄索引從 3 移到 4。
  const metadataCell = nullRow.locator("td").nth(4);
  await expect(metadataCell.getByText("—", { exact: true })).toBeVisible();
  await expect(nullRow.getByRole("button", { name: "更多" })).toHaveCount(0);
  await expect(nullRow.getByRole("button", { name: "收合" })).toHaveCount(0);
});

test("SDLCCT-111 AC1: 版本/部門/觸發方式 all consistent across rows fold into a one-time summary chip row, 廠別 stays an independent per-row column", async ({
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
            metadata: { plant: "P1", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
          {
            id: "trace-002",
            total_estimated_cost: 500,
            metadata: { plant: "P2", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  // Summary chips render once, above the table, not per row.
  await expect(page.getByText("版本: v2.1")).toHaveCount(1);
  await expect(page.getByText("部門: Sales")).toHaveCount(1);
  await expect(page.getByText("觸發方式: manual")).toHaveCount(1);

  // 廠別 differs per row and renders independently in its own column.
  const row1 = page.locator("tr", { hasText: "trace-001" });
  const row2 = page.locator("tr", { hasText: "trace-002" });
  await expect(row1.getByText("P1", { exact: true })).toBeVisible();
  await expect(row2.getByText("P2", { exact: true })).toBeVisible();
  // Neither row repeats the folded fields as its own chip.
  await expect(row1.getByText("版本: v2.1")).toHaveCount(0);
  await expect(row2.getByText("版本: v2.1")).toHaveCount(0);
});

test("SDLCCT-111 AC2: only the inconsistent field (版本) stays per-row; 部門/觸發方式 still fold even though 版本 differs", async ({
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
            metadata: { plant: "P1", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
          {
            id: "trace-002",
            total_estimated_cost: 500,
            metadata: { plant: "P1", deployed_version: "v2.2", dept: "Sales", trigger: "manual" },
          },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  // 部門/觸發方式 still fold into the one-time summary row.
  await expect(page.getByText("部門: Sales")).toHaveCount(1);
  await expect(page.getByText("觸發方式: manual")).toHaveCount(1);
  // 版本 is NOT folded (values differ) -> each row shows its own value
  // instead of a single shared summary chip. (A real fold would show one
  // value page-wide; seeing the two distinct values below, each scoped to
  // its own row, already proves folding did not happen for this field.)
  const row1 = page.locator("tr", { hasText: "trace-001" });
  const row2 = page.locator("tr", { hasText: "trace-002" });
  await expect(row1.getByText("版本: v2.1", { exact: false })).toBeVisible();
  await expect(row2.getByText("版本: v2.2", { exact: false })).toBeVisible();
});

test("SDLCCT-111 AC3: 廠別篩選 only shows rows for the selected plant, and options list only plants actually present in the (unfiltered) list", async ({
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
          { id: "trace-001", total_estimated_cost: 999, metadata: { plant: "P1" } },
          { id: "trace-002", total_estimated_cost: 500, metadata: { plant: "P2" } },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const filter = page.locator('[aria-label="依廠別篩選"]');
  await expect(filter.getByRole("button", { name: "全部" })).toBeVisible();
  await expect(filter.getByRole("button", { name: "P1" })).toBeVisible();
  await expect(filter.getByRole("button", { name: "P2" })).toBeVisible();
  // No extra plant options beyond what's actually present.
  await expect(filter.getByRole("button")).toHaveCount(3);

  await filter.getByRole("button", { name: "P1" }).click();
  await expect(page.locator("tr", { hasText: "trace-001" })).toBeVisible();
  await expect(page.locator("tr", { hasText: "trace-002" })).toHaveCount(0);

  // Filter options remain stable (not narrowed) after filtering.
  await expect(filter.getByRole("button", { name: "P2" })).toBeVisible();

  await filter.getByRole("button", { name: "全部" }).click();
  await expect(page.locator("tr", { hasText: "trace-002" })).toBeVisible();
});

test("SDLCCT-111 AC4 (regression): a row in the filtered top traces list is still clickable and navigates to trace detail", async ({
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
        top_traces: [{ id: "trace-001", total_estimated_cost: 999, metadata: { plant: "P1" } }],
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
  await page.locator("tr", { hasText: "trace-001" }).click();
  await expect(page).toHaveURL(
    `/agents/${MOCK_KEY}/traces/${encodeURIComponent("trace-001")}`,
  );
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

test("SDLCCT-101 AC2: keyboard Enter and Space on a focused top-traces row navigate to the trace detail page", async ({
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
          { id: "trace-001", total_estimated_cost: 999, metadata: null },
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
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/trace-001`);

  // Space key, from a fresh navigation.
  await page.goto(`/agents/${MOCK_KEY}`);
  const rowAgain = page.getByText("trace-001").locator("xpath=ancestor::tr");
  await rowAgain.focus();
  await expect(rowAgain).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/trace-001`);
});

test("SDLCCT-101 AC3: a focused top-traces row shows a clear focus outline", async ({ page }) => {
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
          { id: "trace-001", total_estimated_cost: 999, metadata: null },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.getByText("trace-001").locator("xpath=ancestor::tr");
  await row.focus();
  await expect(row).toBeFocused();

  const outline = await row.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
  });
  // docs/design-system.md §8 token: outline: 2px solid var(--color-accent)
  // (#2563EB = rgb(37, 99, 235)).
  expect(outline.width).toBe("2px");
  expect(outline.style).toBe("solid");
  expect(outline.color).toBe("rgb(37, 99, 235)");
});

test("SDLCCT-101 AC1: hovering a top-traces row shows the hover background and shifts/colors the trailing arrow", async ({
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
          { id: "trace-001", total_estimated_cost: 999, metadata: null },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const row = page.getByText("trace-001").locator("xpath=ancestor::tr");
  const arrow = row.locator("svg").last();

  // Tailwind v4's translate-x-* utility sets the native CSS `translate`
  // property (not the legacy `transform` composite), so that -- not
  // `transform` -- is what group-hover:translate-x-1 changes here.
  const before = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { translate: cs.translate, color: cs.color };
  });

  await row.hover();

  // Poll on `translate` specifically (not the combined object): `color`
  // settles via a CSS transition on the main thread slightly before the
  // compositor-driven `translate` property reflects in getComputedStyle,
  // so polling the pair together can pass on the color change alone while
  // translate is still mid-flight.
  await expect
    .poll(async () => arrow.evaluate((el) => getComputedStyle(el).translate))
    .not.toBe("none");

  const after = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { translate: cs.translate, color: cs.color };
  });
  expect(before.translate).toBe("none");
  expect(after.color).toBe("rgb(37, 99, 235)");
  expect(after.translate).not.toBe("none");
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

test("SDLCCT-80: hovering the version-cost chart at D-2 shows a tooltip listing every version's amount for that day, null as —", async ({
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
              { date: "2026-10-18", value: 123 },
            ],
          },
          {
            version: "v2",
            points: [
              // 2026-10-18 (D-2) absent for v2 -> byDate returns null there.
              { date: "2026-10-14", value: 50 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  const svg = versionSection.locator("svg[role='img']");
  await expect(svg).toBeVisible();

  // No hover yet: tooltip absent, but the table below already has the full
  // dataset (accessibility fallback requires zero interaction).
  await expect(svg.locator('g[data-tooltip="active"]')).toHaveCount(0);
  await expect(versionSection.locator('thead th[data-date-col="2026-10-18"]')).toHaveText("10/18 (日)");

  // SDLCCT-88: data points sit on the table's date column centers. D-2
  // (anchor_date - 2 = 2026-10-18) is the th[data-date-col="2026-10-18"] center.
  const box = await svg.boundingBox();
  const th = versionSection.locator('thead th[data-date-col="2026-10-18"]');
  const thBox = await th.boundingBox();
  if (!box || !thBox) throw new Error("bounding box not available");
  const targetX = thBox.x + thBox.width / 2 - box.x;
  await svg.hover({ position: { x: targetX, y: box.height / 2 } });

  const tooltip = svg.locator('g[data-tooltip="active"]');
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip.locator("text", { hasText: "2026年10月18日" })).toHaveCount(1);
  await expect(tooltip.locator("text", { hasText: "v1: US$ 123" })).toHaveCount(1);
  await expect(tooltip.locator("text", { hasText: "v2: —" })).toHaveCount(1);

  // Moving the mouse off the chart clears the tooltip and crosshair.
  await page.mouse.move(0, 0);
  await expect(svg.locator('g[data-tooltip="active"]')).toHaveCount(0);
});

test("SDLCCT-88: version-cost chart data points align to the table date column centers at 1280 and 768, and the chart has no x-axis date text", async ({
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
              { date: "2026-10-15", value: 120 },
              { date: "2026-10-16", value: null },
              { date: "2026-10-17", value: 140 },
              { date: "2026-10-18", value: 160 },
              { date: "2026-10-19", value: 150 },
              { date: "2026-10-20", value: 170 },
            ],
          },
          {
            version: "v2",
            points: [
              { date: "2026-10-14", value: 50 },
              { date: "2026-10-15", value: 60 },
              { date: "2026-10-16", value: 70 },
              { date: "2026-10-17", value: 80 },
              { date: "2026-10-18", value: 90 },
              { date: "2026-10-19", value: 85 },
              { date: "2026-10-20", value: 95 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/agents/${MOCK_KEY}`);

  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  const svg = versionSection.locator("svg[role='img']");
  await expect(svg).toBeVisible();

  // Scenario 3: no x-axis group and no date text anywhere inside the SVG.
  await expect(svg.locator('g[data-axis="x"]')).toHaveCount(0);
  const svgTexts = await svg.locator("text").allTextContents();
  expect(svgTexts.filter((txt) => /\d{4}年\d{1,2}月\d{1,2}日/.test(txt))).toHaveLength(0);

  // Max |polyline point X - date column center| over all polylines. Date
  // index per point is recovered by matching against the 7 th centers, so we
  // compare every point to the closest column AND require the set of columns
  // hit by v2 (a complete series) to be exactly all 7 in order.
  const maxDeviation = async () =>
    await versionSection.evaluate((section) => {
      const svgEl = section.querySelector("svg[role='img']") as SVGSVGElement;
      const svgLeft = svgEl.getBoundingClientRect().left;
      const centers = Array.from(
        section.querySelectorAll("thead th[data-date-col]"),
      ).map((th) => {
        const r = th.getBoundingClientRect();
        return r.left + r.width / 2 - svgLeft;
      });
      const polylines = Array.from(svgEl.querySelectorAll("polyline"));
      const complete = polylines.find(
        (pl) => (pl.getAttribute("points") ?? "").split(" ").length === 7,
      );
      if (!complete || centers.length !== 7) return Infinity;
      const xs = (complete.getAttribute("points") ?? "")
        .split(" ")
        .map((pt) => Number(pt.split(",")[0]));
      let max = 0;
      xs.forEach((x, i) => {
        max = Math.max(max, Math.abs(x - centers[i]));
      });
      // Every other polyline point must also sit on some column center.
      for (const pl of polylines) {
        for (const pt of (pl.getAttribute("points") ?? "").split(" ")) {
          const x = Number(pt.split(",")[0]);
          max = Math.max(max, Math.min(...centers.map((c) => Math.abs(c - x))));
        }
      }
      return max;
    });

  // Scenario 1: 1280px viewport.
  await expect.poll(maxDeviation).toBeLessThanOrEqual(1);

  // Scenario 2: shrink to 768px, still aligned.
  await page.setViewportSize({ width: 768, height: 800 });
  await expect.poll(maxDeviation).toBeLessThanOrEqual(1);

  // Scenario 4: hover D-2 column center -> crosshair X equals that column center.
  const th = versionSection.locator('thead th[data-date-col="2026-10-18"]');
  const thBox = await th.boundingBox();
  const svgBox = await svg.boundingBox();
  if (!thBox || !svgBox) throw new Error("bounding boxes not available");
  const colCenter = thBox.x + thBox.width / 2;
  await svg.hover({ position: { x: colCenter - svgBox.x, y: svgBox.height / 2 } });
  const tooltip = svg.locator('g[data-tooltip="active"]');
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip.locator("text", { hasText: "v1: US$ 160" })).toHaveCount(1);
  await expect(tooltip.locator("text", { hasText: "v2: US$ 90" })).toHaveCount(1);
  const x1 = Number(await svg.locator("line[stroke-dasharray]").getAttribute("x1"));
  expect(Math.abs(svgBox.x + x1 - colCenter)).toBeLessThanOrEqual(1);

  // Scenario 5: null cell still renders as an em dash in the table.
  await expect(versionSection.locator("tbody tr").first().locator("td").nth(3)).toHaveText("—");
});

test("SDLCCT-88 (tester): version-cost chart stays aligned to the table date column centers at a 390px viewport and with 5 series (legend mode)", async ({
  page,
}) => {
  const dates = [
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ];
  const series = ["v1", "v2", "v3", "v4", "v5"].map((version, s) => ({
    version,
    points: dates.map((date, i) => ({
      date,
      value: s === 0 && i === 2 ? null : 10 + s * 7 + i * 3,
    })),
  }));
  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "Sales Copilot",
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: series,
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/agents/${MOCK_KEY}`);

  const versionSection = page.locator('section[aria-label="版本成本時間序列"]');
  const svg = versionSection.locator("svg[role='img']");
  await expect(svg).toBeVisible();
  await expect(svg.locator('g[data-axis="x"]')).toHaveCount(0);
  // 5 series -> legend, no tail labels.
  await expect(svg.locator('g[data-labels="tail"]')).toHaveCount(0);

  const maxDeviation = async () =>
    await versionSection.evaluate((section) => {
      const svgEl = section.querySelector("svg[role='img']") as SVGSVGElement;
      const svgLeft = svgEl.getBoundingClientRect().left;
      const centers = Array.from(section.querySelectorAll("thead th[data-date-col]")).map(
        (th) => {
          const r = th.getBoundingClientRect();
          return r.left + r.width / 2 - svgLeft;
        },
      );
      const polylines = Array.from(svgEl.querySelectorAll("polyline"));
      if (centers.length !== 7 || polylines.length < 5) return Infinity;
      let max = 0;
      for (const pl of polylines) {
        for (const pt of (pl.getAttribute("points") ?? "").split(" ")) {
          const x = Number(pt.split(",")[0]);
          max = Math.max(max, Math.min(...centers.map((c) => Math.abs(c - x))));
        }
      }
      return max;
    });
  await expect.poll(maxDeviation).toBeLessThanOrEqual(1);

  // Widen to 1024 and re-check.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(maxDeviation).toBeLessThanOrEqual(1);

  // No horizontal overflow of the chart container relative to the viewport.
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

test("SDLCCT-89: version-cost chart shows 4 evenly spaced gridlines aligned to the max and min Y labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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
              { date: "2026-10-19", value: 100 },
              { date: "2026-10-20", value: 400 },
            ],
          },
          {
            version: "v2",
            points: [
              { date: "2026-10-19", value: 50 },
              { date: "2026-10-20", value: 200 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);
  const lines = page.locator("svg g[data-gridlines] > line");
  await expect(lines).toHaveCount(4);
  const ys = await lines.evaluateAll((els) => els.map((e) => Number(e.getAttribute("y1"))));
  const step = (ys[3] - ys[0]) / 3;
  for (let i = 1; i < 4; i++) {
    expect(Math.abs(ys[i] - ys[i - 1] - step)).toBeLessThanOrEqual(1);
  }
  const labels = page.locator('svg g[data-axis="y"] text');
  await expect(labels).toHaveCount(2);
  const labelYs = await labels.evaluateAll((els) => els.map((e) => Number(e.getAttribute("y"))));
  expect(Math.abs(ys[0] - Math.min(...labelYs))).toBeLessThanOrEqual(1);
  expect(Math.abs(ys[3] - Math.max(...labelYs))).toBeLessThanOrEqual(1);
});

test("SDLCCT-89 (tester): narrow 390px viewport keeps 4 gridlines, 2 Y labels and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
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
              { date: "2026-10-19", value: 100 },
              { date: "2026-10-20", value: 400 },
            ],
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });
  await page.goto(`/agents/${MOCK_KEY}`);
  await expect(page.locator("svg g[data-gridlines] > line")).toHaveCount(4);
  await expect(page.locator('svg g[data-axis="y"] text')).toHaveCount(2);
  const strokes = await page
    .locator("svg g[data-gridlines] > line")
    .evaluateAll((els) => els.map((e) => e.getAttribute("stroke")));
  expect(strokes.every((s) => s === "var(--color-border)")).toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

test("SDLCCT-90: version-cost chart draws gradient areas under each continuous run, behind the lines, without blocking hover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const days = [
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ];
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
            points: days.map((date, i) => ({ date, value: i === 2 ? null : 100 + i * 20 })),
          },
          {
            version: "v2",
            points: days.map((date, i) => ({ date, value: 50 + i * 10 })),
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);
  const areas = page.locator("svg g[data-areas] path[data-area]");
  await expect(areas).toHaveCount(3);
  await expect(page.locator('svg g[data-areas] path[data-area="v1"]')).toHaveCount(2);
  await expect(page.locator('svg g[data-areas] path[data-area="v2"]')).toHaveCount(1);
  await expect(page.locator("svg polyline")).toHaveCount(3);

  expect(await areas.first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
    "none",
  );
  await expect(page.locator("svg g[data-areas]")).toHaveAttribute("aria-hidden", "true");

  const ordered = await page.evaluate(() => {
    const g = document.querySelector("svg g[data-gridlines]") as Element;
    const a = document.querySelector("svg g[data-areas]") as Element;
    const p = document.querySelector("svg polyline") as Element;
    return (
      !!(g.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      !!(a.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(ordered).toBe(true);

  const svg = page.locator('svg[role="img"]');
  const box = await svg.boundingBox();
  if (!box) throw new Error("svg has no box");
  await page.mouse.move(box.x + box.width * 0.7, box.y + 120);
  await expect(page.locator('svg g[data-tooltip="active"]')).toBeVisible();
  await expect(page.locator("svg line[stroke-dasharray]")).toHaveCount(1);

  await expect(svg).toHaveAttribute("aria-label", "版本成本時間序列");
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(2);

  const colors = await page.evaluate(() => {
    const path = document.querySelector('svg path[data-area="v1"]') as Element;
    const id = /url\(#(.+)\)/.exec(path.getAttribute("fill") ?? "")?.[1] ?? "";
    const stop = document.getElementById(id)?.querySelector("stop");
    const line = document.querySelector("svg polyline");
    return [stop?.getAttribute("stop-color"), line?.getAttribute("stroke")];
  });
  expect(colors[0]).toBeTruthy();
  expect(colors[0]).toBe(colors[1]);
});

test("SDLCCT-90 (tester): at 390px the areas stay aligned with their polylines, non-interactive, no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const days = [
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ];
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
            points: days.map((date, i) => ({ date, value: i === 3 ? null : 100 + i * 20 })),
          },
        ],
        model_cost_breakdown: [],
        top_traces: [],
      }),
    });
  });
  await page.goto(`/agents/${MOCK_KEY}`);
  const areas = page.locator("svg g[data-areas] path[data-area]");
  await expect(areas).toHaveCount(2);
  const info = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll("svg g[data-areas] path[data-area]"));
    const lines = Array.from(document.querySelectorAll("svg polyline"));
    const firstXY = (s: string) => (s.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/) ?? [""])[0];
    return {
      same: paths.every(
        (p, i) =>
          firstXY(p.getAttribute("d") ?? "") === firstXY(lines[i].getAttribute("points") ?? ""),
      ),
      pe: paths.map((p) => getComputedStyle(p).pointerEvents),
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  expect(info.same).toBe(true);
  expect(info.pe).toEqual(["none", "none"]);
  expect(info.overflow).toBe(true);
});

test("SDLCCT-110 AC1/AC2: top-traces 執行時間欄顯示從合法 UUIDv7 Trace ID 解析出的時間，非合法格式顯示em dash", async ({
  page,
}) => {
  // Date.UTC(2026, 9, 15, 6, 30, 0) === 1792045800000 ===
  // 0x01a13e40da40 -> first 48 bits (12 hex chars) embedded in a UUIDv7,
  // i.e. the first two dash-groups -> 2026/10/15 14:30 Asia/Taipei.
  const validUuidV7 = "01a13e40-da40-7000-8000-000000000000";
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
          { id: validUuidV7, total_estimated_cost: 999, metadata: null },
          // Same length/shape but version nibble is "4", not a legal UUIDv7.
          { id: "01a13e40-da40-4000-8000-000000001234", total_estimated_cost: 500, metadata: null },
        ],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.getByText("執行時間")).toBeVisible();
  await expect(page.getByText("2026/10/15 14:30")).toBeVisible();

  const invalidRow = page.locator("tr", { hasText: "01a13e40…1234" });
  // metadata === null 本身也顯示 "—"（既有行為），所以泛用的 getByText("—")
  // 在這個列裡會比對到兩個元素；用第 2 格（執行時間欄）鎖定本情境真正要
  // 驗證的欄位。
  await expect(invalidRow.locator("td").nth(1).getByText("—")).toBeVisible();
  // Other cells in that same row still render unaffected.
  await expect(invalidRow.getByText("US$ 500.00")).toBeVisible();
});

test("SDLCCT-110 AC3: a full 36-char trace id is truncated with hover title and a working copy button", async ({
  page,
  context,
}) => {
  const fullId = "0199f06a-9680-7000-8000-abcdef012345";
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
        top_traces: [{ id: fullId, total_estimated_cost: 999, metadata: null }],
      }),
    });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto(`/agents/${MOCK_KEY}`);

  // Truncated display: 前8碼…後4碼.
  await expect(page.getByText("0199f06a…2345")).toBeVisible();
  await expect(page.getByText(fullId)).toHaveCount(0);

  // getByText with exact element-containing-text matching resolves to the
  // wrapping <span title=...> itself here (it's the smallest element whose
  // own text equals the truncated string), not a descendant -- so assert
  // the title directly on it rather than walking to an ancestor.
  const cell = page.getByText("0199f06a…2345");
  await expect(cell).toHaveAttribute("title", fullId);

  // exact: true -- the enclosing <tr role="button"> also has an accessible
  // name containing "複製完整 Trace ID" (it includes all its cells' text),
  // so a non-exact match resolves to both the row and the actual button.
  const copyButton = page.getByRole("button", { name: "複製完整 Trace ID", exact: true });
  await copyButton.click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(fullId);
  await expect(page.getByText("已複製")).toBeVisible();

  // Clicking the copy button must not trigger the row's own click-to-navigate
  // behaviour (SDLCCT-101 compatibility -- stopPropagation).
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}`);
});

test("SDLCCT-110: short e2e-fixture trace ids (e.g. trace-001) remain fully visible, unaffected by truncation", async ({
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

  await expect(page.getByText("trace-001")).toBeVisible();
  await expect(page.getByText("trace-002")).toBeVisible();
  const row = page.getByText("trace-001").locator("xpath=ancestor::tr");
  // Scoped to the start-time column specifically (2nd <td>): since SDLCCT-111
  // added an always-present 廠別 column that also shows "—" when metadata
  // lacks a plant key, a row-wide getByText("—") can now match more than
  // one cell and this must not be ambiguous.
  await expect(row.locator("td").nth(1)).toHaveText("—"); // 執行時間欄：非合法 UUIDv7。

  // Row navigation still works for these short-id rows (SDLCCT-56/101).
  await row.click();
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/trace-001`);
});
