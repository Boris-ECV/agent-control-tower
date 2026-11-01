import { expect, test, type Page } from "@playwright/test";

const KEY = "sales-copilot";
const NAME = "Sales Copilot";
const TRACE = "trc_123";
const LONG_NAME =
  "An Extremely Long Agent Display Name That Should Never Cause Horizontal Overflow On Phones Whatsoever";
const NO_SPACE_NAME = "VeryLongAgentNameWithoutAnySpaces".repeat(3);

const costBody = (display: string) =>
  JSON.stringify({
    key: KEY,
    display,
    anchor_date: "2026-10-20",
    period_start: "2026-10-01",
    version_cost_series: [],
    model_cost_breakdown: [],
    top_traces: [{ id: TRACE, total_estimated_cost: 1, metadata: null }],
  });

async function mockSpans(page: Page) {
  await page.route(`**/api/agents/${KEY}/traces/${TRACE}/spans`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: KEY, trace_id: TRACE, spans: [] }),
    }),
  );
}

async function mock(page: Page, display = NAME) {
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: costBody(display) }),
  );
  await mockSpans(page);
}

const tracePath = `/agents/${KEY}/traces/${TRACE}`;
const nameLink = (page: Page) =>
  page.getByRole("link", { name: `返回 ${NAME}`, exact: true });
const keyLink = (page: Page) =>
  page.getByRole("link", { name: `返回 ${KEY}`, exact: true });
const crumbs = (page: Page) => page.getByRole("navigation", { name: "麵包屑" });

test("trace page back link shows the agent display name", async ({ page }) => {
  await mock(page);
  await page.goto(tracePath);
  await expect(nameLink(page)).toBeVisible();
  await expect(nameLink(page)).toHaveText(`返回 ${NAME}`);
  await expect(nameLink(page)).toHaveAttribute("href", `/agents/${KEY}`);
});

test("while loading shows the key, then swaps to the display name", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await mockSpans(page);
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: costBody(NAME) });
  });
  await page.goto(tracePath);
  await expect(keyLink(page)).toBeVisible();
  release();
  await expect(nameLink(page)).toBeVisible();
  await expect(keyLink(page)).toHaveCount(0);
});

test("lookup failure keeps the key and the link still works", async ({ page }) => {
  await mockSpans(page);
  await page.route(`**/api/agents/${KEY}/cost-breakdown`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "boom" } }),
    }),
  );
  await page.goto(tracePath);
  await expect(keyLink(page)).toBeVisible();
  await expect(keyLink(page)).toHaveAttribute("href", `/agents/${KEY}`);
  await keyLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("mouse click navigates to the agent page", async ({ page }) => {
  await mock(page);
  await page.goto(tracePath);
  await nameLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("Enter navigates to the agent page", async ({ page }) => {
  await mock(page);
  await page.goto(tracePath);
  await nameLink(page).focus();
  await expect(nameLink(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("Space navigates to the agent page", async ({ page }) => {
  await mock(page);
  await page.goto(tracePath);
  await nameLink(page).focus();
  await expect(nameLink(page)).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("agent page back link stays 返回 Agent 清單", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}`);
  const link = page.getByRole("link", { name: "返回 Agent 清單", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/agents");
  await link.click();
  await expect(page).toHaveURL(/\/agents$/);
});

test("direct trace page load issues exactly one cost-breakdown request", async ({ page }) => {
  let count = 0;
  page.on("request", (req) => {
    if (req.url().includes(`/api/agents/${KEY}/cost-breakdown`)) count++;
  });
  await mock(page);
  await page.goto(tracePath);
  await expect(nameLink(page)).toBeVisible();
  await expect(crumbs(page).getByRole("link", { name: NAME, exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(count).toBe(1);
});

test.describe("390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [label, display] of [
    ["long name with spaces", LONG_NAME],
    ["long name without spaces", NO_SPACE_NAME],
  ] as const) {
    test(`back link does not overflow: ${label}`, async ({ page }) => {
      await mock(page, display);
      await page.goto(tracePath);
      const link = page.getByRole("link", { name: `返回 ${display}`, exact: true });
      await expect(link).toBeVisible();
      const r = await page.evaluate(() => {
        const d = document.documentElement;
        return { fits: d.scrollWidth <= d.clientWidth, width: window.innerWidth };
      });
      expect(r.fits).toBe(true);
      const box = await link.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(r.width);
    });
  }
});
