import { expect, test, type Page } from "@playwright/test";

// SDLCCT-95 acceptance: dates `YYYY/MM/DD`, datetimes `YYYY/MM/DD HH:mm:ss`
// (Asia/Taipei), day-column headers `M/D (週)`. Out-of-scope texts stay old.

async function json(page: Page, glob: string, body: unknown) {
  await page.route(glob, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

const ANOMALIES = {
  anchor_date: "2026-10-20",
  anomalies: [
    { agent: "a-one", anomaly_type: "tool_retry_loop", date: "2026-10-18", status: "ok", reason: "r1" },
    { agent: "a-two", anomaly_type: "night_batch_burst", date: "2026-01-05", status: "ok", reason: "r2" },
    { agent: "a-three", anomaly_type: "governance_gap", date: null, status: "ok", reason: "r3" },
  ],
};

const SLASH_DATE = /^\d{4}\/\d{2}\/\d{2}$/;

test("anomalies desktop table: every date cell is YYYY/MM/DD; top-bar date keeps old style", async ({ page }) => {
  await json(page, "**/api/anomalies", ANOMALIES);
  await page.goto("/anomalies");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(3);
  const texts: string[] = [];
  for (let i = 0; i < 3; i++) {
    // date is the only cell holding a date or the 持續中 placeholder
    const cells = await rows.nth(i).locator("td").allInnerTexts();
    const dateCell = cells.map((c) => c.trim()).find((c) => /\d{4}|持續中/.test(c) && !/^a-/.test(c));
    texts.push(dateCell ?? "");
  }
  expect(texts.filter((t) => t !== "持續中").sort()).toEqual(["2026/01/05", "2026/10/18"]);
  for (const t of texts.filter((t) => t !== "持續中")) expect(t).toMatch(SLASH_DATE);
  expect(texts).toContain("持續中");
  // Out of scope: top-bar date stays in the old style (SDLCCT-103 replaces it).
  await expect(page.locator("header").getByText("2026年10月20日", { exact: true })).toBeVisible();
});

test("anomalies 390px mobile card: every date is YYYY/MM/DD", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await json(page, "**/api/anomalies", ANOMALIES);
  await page.goto("/anomalies");
  await expect(page.locator("table")).toBeHidden();
  const cards = page.getByRole("list").locator("li", { hasText: /a-one|a-two/ });
  await expect(cards).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const t = (await cards.nth(i).innerText()).match(/\d{4}[/年]\d{1,2}[/月]\d{1,2}日?/)?.[0];
    expect(t).toMatch(SLASH_DATE);
  }
  await expect(page.getByRole("list").getByText("2026/10/18")).toBeVisible();
  await expect(page.getByRole("list").getByText("2026/01/05")).toBeVisible();
});

const COST_BREAKDOWN = {
  key: "sales-copilot",
  display: "Sales Copilot",
  anchor_date: "2026-10-20",
  period_start: "2026-10-01",
  version_cost_series: [
    { version: "v1", points: [{ date: "2026-10-18", value: 100 }, { date: "2026-10-19", value: 150 }] },
  ],
  model_cost_breakdown: [],
  top_traces: [],
};

test("version-cost a11y table: 7 consecutive M/D (weekday) headers agreeing with the real calendar; tooltip line unchanged", async ({ page }) => {
  await json(page, "**/api/agents/sales-copilot/cost-breakdown", COST_BREAKDOWN);
  await page.goto("/agents/sales-copilot");
  const section = page.locator('section[aria-label="版本成本時間序列"]');
  await expect(section.locator("thead th")).toHaveCount(8);
  const headers = (await section.locator("thead th").allTextContents()).slice(1).map((s) => s.trim());
  expect(headers).toHaveLength(7);
  const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  const parsed = headers.map((h) => {
    expect(h).toMatch(/^\d{1,2}\/\d{1,2} \([日一二三四五六]\)$/);
    const m = h.match(/^(\d{1,2})\/(\d{1,2}) \((.)\)$/)!;
    return { mo: Number(m[1]), d: Number(m[2]), wd: m[3], raw: h };
  });
  let prev: number | null = null;
  for (const p of parsed) {
    // not zero-padded
    expect(p.raw).not.toMatch(/(^|\/)0\d/);
    const ms = Date.UTC(2026, p.mo - 1, p.d);
    expect(p.wd).toBe(WEEK[new Date(ms).getUTCDay()]);
    if (prev !== null) expect(ms - prev).toBe(86400000);
    prev = ms;
  }
  expect(parsed[0].raw.startsWith("10/14")).toBe(true);
  expect(parsed[6].raw.startsWith("10/20")).toBe(true);

  // Out of scope: chart tooltip first line keeps 2026年10月18日 style.
  const svg = section.locator("svg[role='img']");
  const box = await svg.boundingBox();
  const thBox = await section.locator('thead th[data-date-col="2026-10-18"]').boundingBox();
  if (!box || !thBox) throw new Error("bounding box not available");
  await svg.hover({ position: { x: thBox.x + thBox.width / 2 - box.x, y: box.height / 2 } });
  await expect(svg.locator('g[data-tooltip="active"] text', { hasText: "2026年10月18日" })).toHaveCount(1);
});

test("agent detail at 390px: no horizontal overflow with new day headers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await json(page, "**/api/agents/sales-copilot/cost-breakdown", COST_BREAKDOWN);
  await page.goto("/agents/sales-copilot");
  await expect(page.locator('section[aria-label="版本成本時間序列"] thead th').nth(1)).toHaveText("10/14 (三)");
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
});

test("trace detail: span start/end are YYYY/MM/DD HH:mm:ss, equal mock UTC +8h", async ({ page }) => {
  await json(page, "**/api/agents/sales-copilot/traces/trc_9/spans", {
    key: "sales-copilot",
    trace_id: "trc_9",
    spans: [
      {
        id: "s1",
        parent_span_id: null,
        name: "root-chain",
        type: "general",
        // crosses a day/month boundary after +8h
        start_time: "2026-10-31T16:05:09Z",
        end_time: "2026-11-01T01:02:03Z",
        children: [],
      },
    ],
  });
  await page.goto("/agents/sales-copilot/traces/trc_9");
  await expect(page.getByText("root-chain")).toBeVisible();
  const re = /(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})–(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
  const body = await page.locator("body").innerText();
  const m = body.match(re);
  expect(m).not.toBeNull();
  expect(m![1]).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(m![1]).toBe("2026/11/01 00:05:09");
  expect(m![2]).toBe("2026/11/01 09:02:03");
});

test("cost dashboard: period-comparison header ranges keep the old 10/1–10/28 style", async ({ page }) => {
  await json(page, "**/api/cost-overview/summary", {
    anchor_date: "2026-10-28",
    total_spend: 100,
    total_budget: 500,
    budget_consumed_pct: 20,
    projected_overspend: 0,
    days_in_month: 31,
    unregistered: { agents: [] },
  });
  await json(page, "**/api/cost-overview/period-comparison", {
    current_period: { start: "2026-10-01", end: "2026-10-28" },
    previous_period: { start: "2026-09-01", end: "2026-09-28" },
    agents: [
      { key: "p1", display: "grower", current_cost: 10, previous_cost: 5, delta: 5, delta_pct: 100 },
    ],
  });
  await page.goto("/cost-dashboard");
  await expect(page.getByText("本期花費（10/1–10/28）")).toBeVisible();
  await expect(page.getByText("今天（台灣時間）：2026年10月28日")).toBeVisible();
});
