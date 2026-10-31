import { expect, test, type Page } from "@playwright/test";

const KEY = "sales-copilot";
const LONG_TRACE = "trace-0123456789abcdef";
const SHORT_TRACE = "trc_123";
const LONG_NAME = "Very Long Agent Display Name For Mobile Overflow Check Number One Two";

async function mockApis(page: Page, display = "Sales Copilot", onBreakdown?: () => void) {
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, async (route) => {
    onBreakdown?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: KEY,
        display,
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: LONG_TRACE, total_estimated_cost: 1, metadata: null }],
      }),
    });
  });
  for (const id of [LONG_TRACE, SHORT_TRACE]) {
    await page.route(`**/api/agents/${KEY}/traces/${id}/spans`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ key: KEY, trace_id: id, spans: [] }),
      });
    });
  }
}

const crumbs = (page: Page) => page.getByRole("navigation", { name: "麵包屑" });

test("agent detail shows 治理 / Agent 清單 / name with current page", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}`);
  const nav = crumbs(page);
  await expect(nav.getByRole("listitem")).toHaveText([/^治理\s*\/$/, /^Agent 清單\s*\/$/, "Sales Copilot"]);
  await expect(nav.getByRole("link")).toHaveCount(2);
  const last = nav.getByText("Sales Copilot");
  await expect(last).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Sales Copilot" })).toHaveCount(0);
});

test("trace detail shows four levels with truncated id", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}/traces/${LONG_TRACE}`);
  const nav = crumbs(page);
  await expect(nav.getByRole("link")).toHaveCount(3);
  await expect(nav.getByRole("link", { name: "Sales Copilot" })).toBeVisible();
  const last = nav.locator('[aria-current="page"]');
  await expect(last).toHaveText("trace-01…");
  await expect(last).toHaveAttribute("title", LONG_TRACE);
});

test("short trace id is not truncated", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}/traces/${SHORT_TRACE}`);
  await expect(crumbs(page).locator('[aria-current="page"]')).toHaveText(SHORT_TRACE);
});

test("clicking Agent 清單 on agent detail navigates to /agents", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}`);
  await crumbs(page).getByRole("link", { name: "Agent 清單" }).click();
  await expect(page).toHaveURL(/\/agents$/);
});

test("clicking 治理 on agent detail navigates to /agents", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}`);
  await crumbs(page).getByRole("link", { name: "治理" }).click();
  await expect(page).toHaveURL(/\/agents$/);
});

test("clicking agent name on trace detail navigates to agent detail", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/agents/${KEY}/traces/${LONG_TRACE}`);
  await crumbs(page).getByRole("link", { name: "Sales Copilot" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("agent detail -> trace reuses cached name without a second cost-breakdown request", async ({
  page,
}) => {
  let count = 0;
  await mockApis(page, "Sales Copilot", () => count++);
  await page.goto(`/agents/${KEY}`);
  await page.getByText(LONG_TRACE).locator("xpath=ancestor::tr").click();
  await expect(page).toHaveURL(`/agents/${KEY}/traces/${LONG_TRACE}`);
  await expect(crumbs(page).getByRole("link", { name: "Sales Copilot" })).toBeVisible();
  expect(count).toBe(1);
});

test("falls back to the agent key when cost-breakdown fails", async ({ page }) => {
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.route(`**/api/agents/${KEY}/traces/${SHORT_TRACE}/spans`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: KEY, trace_id: SHORT_TRACE, spans: [] }),
    }),
  );
  await page.goto(`/agents/${KEY}/traces/${SHORT_TRACE}`);
  await expect(crumbs(page).getByRole("link", { name: KEY })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(SHORT_TRACE);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function expectNoOverflow(page: Page, expectedItems: number) {
    const nav = crumbs(page);
    await expect(nav.getByRole("listitem")).toHaveCount(expectedItems);
    for (const li of await nav.getByRole("listitem").all()) await expect(li).toBeVisible();
    const info = await page.evaluate(() => {
      const n = document.querySelector('nav[data-slot="breadcrumbs"]') as HTMLElement;
      return {
        doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        nav: n.scrollWidth <= n.clientWidth,
      };
    });
    expect(info.doc).toBe(true);
    expect(info.nav).toBe(true);
  }

  test("agent detail with a long name does not overflow", async ({ page }) => {
    await mockApis(page, LONG_NAME);
    await page.goto(`/agents/${KEY}`);
    await expect(crumbs(page).getByText(LONG_NAME)).toBeVisible();
    await expectNoOverflow(page, 3);
    const overflow = await crumbs(page)
      .getByText(LONG_NAME)
      .evaluate((el) => getComputedStyle(el).textOverflow);
    expect(overflow).toBe("ellipsis");
  });

  test("trace detail with a long name does not overflow", async ({ page }) => {
    await mockApis(page, LONG_NAME);
    await page.goto(`/agents/${KEY}`);
    await page.getByText(LONG_TRACE).locator("xpath=ancestor::tr").click();
    await expect(page).toHaveURL(`/agents/${KEY}/traces/${LONG_TRACE}`);
    await expect(crumbs(page).getByRole("link", { name: LONG_NAME })).toBeVisible();
    await expectNoOverflow(page, 4);
  });
});
