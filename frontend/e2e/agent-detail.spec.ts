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
  // formatTaiwanDate renders dates as e.g. "2026年10月14日"; assert the full
  // ordered set of day labels for 2026-10-14..2026-10-20.
  expect(dateHeaders.slice(1)).toEqual([
    "2026年10月14日",
    "2026年10月15日",
    "2026年10月16日",
    "2026年10月17日",
    "2026年10月18日",
    "2026年10月19日",
    "2026年10月20日",
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
  await expect(page.getByText("2026年10月18日")).toBeVisible();

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
