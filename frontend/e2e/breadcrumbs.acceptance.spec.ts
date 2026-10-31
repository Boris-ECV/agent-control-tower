import { expect, test, type Page } from "@playwright/test";

const KEY = "sales-copilot";
const NAME = "Sales Copilot";
const TRACE = "trace-0123456789abcdef";
const LONG_NAME =
  "An Extremely Long Agent Display Name That Should Never Cause Horizontal Overflow On Phones Whatsoever";
const LONG_TRACE = "trace-" + "x".repeat(80);

async function mock(page: Page, display = NAME, traceId = TRACE) {
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: KEY,
        display,
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: traceId, total_estimated_cost: 1, metadata: null }],
      }),
    }),
  );
  await page.route(`**/api/agents/${KEY}/traces/${traceId}/spans`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: KEY, trace_id: traceId, spans: [] }),
    }),
  );
}

const nav = (page: Page) => page.getByRole("navigation", { name: "麵包屑" });

async function texts(page: Page) {
  const items = await nav(page).getByRole("listitem").allTextContents();
  return items.map((s) => s.replace(/\s*\/\s*$/, "").trim());
}

test("agent detail: text sequence, links vs current page", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}`);
  await expect(nav(page).getByText(NAME)).toBeVisible();
  expect(await texts(page)).toEqual(["治理", "Agent 清單", NAME]);
  await expect(nav(page).getByRole("link")).toHaveText(["治理", "Agent 清單"]);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveText(NAME);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveCount(0);
});

test("trace detail: text sequence, links vs current page", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}/traces/${TRACE}`);
  await expect(nav(page).getByRole("link", { name: NAME })).toBeVisible();
  expect(await texts(page)).toEqual(["治理", "Agent 清單", NAME, "trace-01…"]);
  await expect(nav(page).getByRole("link")).toHaveText(["治理", "Agent 清單", NAME]);
  const cur = nav(page).locator('[aria-current="page"]');
  await expect(cur).toHaveCount(1);
  await expect(cur).toHaveText("trace-01…");
  await expect(nav(page).getByRole("link", { name: "trace-01…" })).toHaveCount(0);
});

test("trace detail: each linked level navigates", async ({ page }) => {
  await mock(page);
  const start = `/agents/${KEY}/traces/${TRACE}`;

  await page.goto(start);
  await nav(page).getByRole("link", { name: "治理" }).click();
  await expect(page).toHaveURL(/\/agents$/);

  await page.goto(start);
  await nav(page).getByRole("link", { name: "Agent 清單" }).click();
  await expect(page).toHaveURL(/\/agents$/);

  await page.goto(start);
  await nav(page).getByRole("link", { name: NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("agent detail: each linked level navigates", async ({ page }) => {
  await mock(page);
  for (const name of ["治理", "Agent 清單"]) {
    await page.goto(`/agents/${KEY}`);
    await nav(page).getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/agents$/);
  }
});

test("no breadcrumb on other pages", async ({ page }) => {
  for (const path of ["/cost-dashboard", "/agents", "/anomalies", "/settings/system"]) {
    await page.goto(path);
    await expect(page.locator("main, body").first()).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  }
});

test("back link text unchanged", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}`);
  await expect(page.getByRole("link", { name: "返回 Agent 清單" })).toBeVisible();
  await page.goto(`/agents/${KEY}/traces/${TRACE}`);
  await expect(page.getByRole("link", { name: "返回 Agent 明細" })).toBeVisible();
});

test("keyboard: Tab to crumb link and Enter navigates", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}/traces/${TRACE}`);
  const link = nav(page).getByRole("link", { name: NAME });
  await expect(link).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await link.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test.describe("390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function expectFits(page: Page, docToo = true) {
    const r = await page.evaluate(() => {
      const d = document.documentElement;
      const n = document.querySelector('nav[aria-label="麵包屑"]') as HTMLElement;
      const b = n.getBoundingClientRect();
      return {
        docFits: d.scrollWidth <= d.clientWidth,
        navFits: n.scrollWidth <= n.clientWidth,
        navInside: b.left >= -1 && b.right <= window.innerWidth + 1,
      };
    });
    if (docToo) expect(r.docFits).toBe(true);
    expect(r.navFits).toBe(true);
    expect(r.navInside).toBe(true);
  }

  test("long agent name on agent page", async ({ page }) => {
    await mock(page, LONG_NAME);
    await page.goto(`/agents/${KEY}`);
    await expect(nav(page).getByText(LONG_NAME)).toBeVisible();
    await expectFits(page);
  });

  test("long agent name on trace page", async ({ page }) => {
    await mock(page, LONG_NAME);
    await page.goto(`/agents/${KEY}/traces/${TRACE}`);
    await expect(nav(page).getByRole("link", { name: LONG_NAME })).toBeVisible();
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expectFits(page);
  });

  // Document-level overflow is NOT asserted here: the page <h1> renders the full
  // trace id unbroken and overflows by itself (not part of the breadcrumb).
  test("very long trace id: breadcrumb itself stays inside the viewport", async ({ page }) => {
    await mock(page, LONG_NAME, LONG_TRACE);
    await page.goto(`/agents/${KEY}/traces/${LONG_TRACE}`);
    await expect(nav(page).locator('[aria-current="page"]')).toHaveText("trace-xx…");
    await expectFits(page, false);
  });
});
