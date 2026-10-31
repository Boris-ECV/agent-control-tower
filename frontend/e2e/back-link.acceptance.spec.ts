import { expect, test, type Page } from "@playwright/test";

const KEY = "sales-copilot";
const TRACE = "trace-0123456789abcdef";
const SHORT_TRACE = "t1";

type Mode = "ok" | "error" | "blank";

async function mock(
  page: Page,
  opts: { key?: string; display?: string; mode?: Mode; trace?: string } = {},
) {
  const key = opts.key ?? KEY;
  const trace = opts.trace ?? TRACE;
  const mode = opts.mode ?? "ok";
  const counter = { n: 0 };
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.endsWith(`/api/agents/${key}/cost-breakdown`)) counter.n++;
  });
  await page.route(`**/api/agents/${key}/cost-breakdown`, (route) => {
    if (mode === "error") {
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key,
        display: mode === "blank" ? "" : (opts.display ?? "Sales Copilot"),
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: trace, total_estimated_cost: 1, metadata: null }],
      }),
    });
  });
  await page.route(`**/api/agents/${key}/traces/${trace}/spans`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key, trace_id: trace, spans: [] }),
    }),
  );
  return counter;
}

const back = (page: Page, name: string) => page.getByRole("link", { name, exact: true });
const traceUrl = (key = KEY, trace = TRACE) => `/agents/${key}/traces/${trace}`;
const noOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth;
  });

const NAMES: Array<[string, string, string]> = [
  ["cjk", "sales-copilot", "銷售智慧助理"],
  ["punctuation", "rd-bot", 'R&D "Bot" <1>'],
];

for (const [label, key, display] of NAMES) {
  test(`trace page back link text is exact and literal (${label})`, async ({ page }) => {
    await mock(page, { key, display });
    await page.goto(traceUrl(key));
    const link = back(page, `返回 ${display}`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/agents/${key}`);
    await expect(link).toHaveText(`返回 ${display}`);
    // no HTML injection: the name is text; the only element child besides the svg is the span
    expect(await link.evaluate((el) => Array.from(el.children).map((c) => c.tagName))).toEqual([
      "svg",
      "SPAN",
    ]);
    if (label === "punctuation") expect(await link.innerHTML()).toContain("&lt;1&gt;");
  });
}

test("agent page back link is 返回 Agent 清單 with href /agents", async ({ page }) => {
  await mock(page);
  await page.goto(`/agents/${KEY}`);
  const link = back(page, "返回 Agent 清單");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/agents");
  await expect(link).toHaveText("返回 Agent 清單");
});

test("accessible name equals visible text (no aria-label)", async ({ page }) => {
  await mock(page);
  await page.goto(traceUrl());
  const link = back(page, "返回 Sales Copilot");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("aria-label", /.+/);
  await expect(link).toHaveText("返回 Sales Copilot");
  await page.goto(`/agents/${KEY}`);
  const l2 = back(page, "返回 Agent 清單");
  await expect(l2).not.toHaveAttribute("aria-label", /.+/);
});

test("trace page: mouse click navigates to agent page", async ({ page }) => {
  await mock(page);
  await page.goto(traceUrl());
  await back(page, "返回 Sales Copilot").click();
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("trace page: Enter navigates to agent page", async ({ page }) => {
  await mock(page);
  await page.goto(traceUrl());
  const link = back(page, "返回 Sales Copilot");
  await expect(link).toBeVisible();
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("trace page: Space navigates to agent page", async ({ page }) => {
  await mock(page);
  await page.goto(traceUrl());
  const link = back(page, "返回 Sales Copilot");
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(new RegExp(`/agents/${KEY}$`));
});

test("agent page: click, Enter and Space navigate to /agents", async ({ page }) => {
  await mock(page);
  for (const how of ["click", "Enter", "Space"] as const) {
    await page.goto(`/agents/${KEY}`);
    const link = back(page, "返回 Agent 清單");
    await expect(link).toBeVisible();
    if (how === "click") await link.click();
    else {
      await link.focus();
      await page.keyboard.press(how);
    }
    await expect(page).toHaveURL(/\/agents$/);
  }
});

test("direct trace load makes exactly one cost-breakdown request", async ({ page }) => {
  const counter = await mock(page);
  await page.goto(traceUrl());
  await expect(back(page, "返回 Sales Copilot")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "麵包屑" }).getByRole("link", { name: "Sales Copilot", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(counter.n).toBe(1);
});

test("agent page -> trace page via client navigation: name immediate, still 1 request", async ({ page }) => {
  const counter = await mock(page);
  await page.goto(`/agents/${KEY}`);
  await expect(
    page.getByRole("navigation", { name: "麵包屑" }).getByText("Sales Copilot", { exact: true }),
  ).toBeVisible();
  const traceLink = page.locator("main tr[role=button]", { hasText: TRACE });
  await expect(traceLink).toBeVisible();
  await traceLink.click();
  await expect(page).toHaveURL(new RegExp(`${traceUrl()}$`));
  await expect(back(page, "返回 Sales Copilot")).toBeVisible();
  await page.waitForTimeout(500);
  expect(counter.n).toBe(1);
});

for (const mode of ["error", "blank"] as const) {
  test(`cost-breakdown ${mode}: falls back to 返回 {key}, no crash`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mock(page, { mode });
    await page.goto(traceUrl());
    const link = back(page, `返回 ${KEY}`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/agents/${KEY}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test.describe("390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const WITH_SPACES = Array.from({ length: 20 }, (_, i) => `Agent${i}`).join(" ").padEnd(120, "z").slice(0, 120);
  const NO_SPACES = "N".repeat(60);

  for (const [label, display] of [
    ["120 chars with spaces", WITH_SPACES],
    ["60 chars without spaces", NO_SPACES],
  ] as const) {
    test(`no horizontal overflow, ${label}`, async ({ page }) => {
      await mock(page, { display, trace: SHORT_TRACE });
      await page.goto(traceUrl(KEY, SHORT_TRACE));
      const link = back(page, `返回 ${display}`);
      await expect(link).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
    });
  }
});
