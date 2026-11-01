import { expect, test, type Page } from "@playwright/test";

// SDLCCT-103: every page's top bar shows the page-load time in Asia/Taipei,
// independent of any bff response. All tests pin the browser clock.

const PAGES = [
  { name: "cost-dashboard", path: "/cost-dashboard", multiLine: false },
  { name: "anomalies", path: "/anomalies", multiLine: false },
  { name: "agents", path: "/agents", multiLine: false },
  { name: "agent-detail", path: "/agents/sales-copilot", multiLine: true },
];

const STAMP = "page-header-timestamp";

async function failApi(page: Page) {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
}

for (const p of PAGES) {
  test.describe(p.name, () => {
    test("shows load time 2026/10/15 14:30 even when the bff fails", async ({ page }) => {
      await page.clock.setFixedTime("2026-10-15T06:30:00Z");
      await failApi(page);
      await page.goto(p.path);
      const header = page.locator("header");
      await expect(header.getByTestId(STAMP)).toHaveText("資料更新於 2026/10/15 14:30（台灣時間）");
      await expect(header.getByText("無法取得")).toHaveCount(0);
      await expect(page.getByText("今天（台灣時間）")).toHaveCount(0);
      expect(await header.innerText()).not.toMatch(/\d{4}年/);
    });

    test("rolls over to the next Taipei day (UTC 17:05)", async ({ page }) => {
      await page.clock.setFixedTime("2026-10-15T17:05:00Z");
      await failApi(page);
      await page.goto(p.path);
      await expect(page.getByTestId(STAMP)).toHaveText("資料更新於 2026/10/16 01:05（台灣時間）");
    });

    test("no hydration warnings and no header layout shift", async ({ page }) => {
      const messages: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") messages.push(m.text());
      });
      page.on("pageerror", (e) => messages.push(String(e)));
      await page.addInitScript(() => {
        const w = window as unknown as { __headerShift: number };
        w.__headerShift = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{
            hadRecentInput: boolean;
            value: number;
            sources?: Array<{ node: Node | null }>;
          }>) {
            if (entry.hadRecentInput) continue;
            const inHeader = (entry.sources ?? []).some((s) => {
              const el = s.node instanceof Element ? s.node : s.node?.parentElement;
              return !!el?.closest("header");
            });
            if (inHeader) w.__headerShift += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.clock.setFixedTime("2026-10-15T06:30:00Z");
      await failApi(page);
      await page.goto(p.path);
      await expect(page.getByTestId(STAMP)).toHaveText("資料更新於 2026/10/15 14:30（台灣時間）");
      expect(messages.filter((m) => /hydrat/i.test(m))).toEqual([]);
      expect(
        await page.evaluate(() => (window as unknown as { __headerShift: number }).__headerShift),
      ).toBe(0);
    });

    test("390px: no horizontal overflow, stamp fits in viewport", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime("2026-10-15T06:30:00Z");
      await failApi(page);
      await page.goto(p.path);
      const stamp = page.getByTestId(STAMP);
      await expect(stamp).toHaveText("資料更新於 2026/10/15 14:30（台灣時間）");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = (await stamp.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      if (!p.multiLine) expect(Math.round(box.height)).toBe(18);
    });
  });
}

test.describe("timezone independence", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("browser timezone does not change the Taipei time", async ({ page }) => {
    await page.clock.setFixedTime("2026-10-15T06:30:00Z");
    await failApi(page);
    await page.goto("/anomalies");
    await expect(page.getByTestId(STAMP)).toHaveText("資料更新於 2026/10/15 14:30（台灣時間）");
  });
});
