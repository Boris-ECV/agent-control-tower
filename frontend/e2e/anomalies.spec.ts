import { expect, test } from "@playwright/test";

test("anomalies page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/anomalies");

  // The sticky header no longer duplicates the sidebar's product title
  // (SDLCCT-68); the sidebar nav (components/layout/app-sidebar.tsx) remains
  // the sole place "Agent Control Tower" is rendered.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "異常與告警" }),
  ).toBeVisible();
});

test("sidebar 異常與告警項目可導覽至 /anomalies", async ({ page }) => {
  await page.goto("/cost-dashboard");

  await page.getByRole("link", { name: "異常與告警" }).click();

  await expect(page).toHaveURL(/\/anomalies$/);
  await expect(
    page.getByRole("heading", { name: "異常與告警" }),
  ).toBeVisible();
});

test("sidebar 異常與告警項目在導覽後顯示 active 樣式狀態", async ({ page }) => {
  await page.goto("/cost-dashboard");

  const anomalyAlertsLink = page.getByRole("link", { name: "異常與告警" });
  const costDashboardLink = page.getByRole("link", { name: "成本儀表板" });

  // Before navigating to /anomalies, the 異常與告警 item must not be marked
  // active (components/ui/sidebar.tsx's SidebarMenuButton only renders the
  // data-active attribute at all when isActive is true; when false the
  // attribute is simply absent from the DOM).
  await expect(anomalyAlertsLink).not.toHaveAttribute("data-active");
  await expect(costDashboardLink).toHaveAttribute("data-active");

  await anomalyAlertsLink.click();
  await expect(page).toHaveURL(/\/anomalies$/);

  await expect(anomalyAlertsLink).toHaveAttribute("data-active");
  await expect(costDashboardLink).not.toHaveAttribute("data-active");
});

test("anomalies page renders ok rows, null-date ongoing text, and error banners (AC1-AC4)", async ({
  page,
}) => {
  await page.route("**/api/anomalies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        anomalies: [
          {
            agent: "sales-copilot",
            anomaly_type: "tool_retry_loop",
            date: "2026-10-18",
            status: "ok",
            reason: "連續 5 次工具呼叫重試",
          },
          {
            agent: "finance-assistant",
            anomaly_type: "governance_gap",
            date: null,
            status: "ok",
            reason: "尚未登錄 Agent registry",
          },
          {
            agent: "ops-bot",
            anomaly_type: "night_batch_burst",
            date: null,
            status: "error",
            reason: "查詢觀測性後端逾時",
          },
          {
            agent: null,
            anomaly_type: "governance_gap",
            date: null,
            status: "error",
            reason: "整批治理缺口規則執行失敗",
          },
        ],
      }),
    });
  });

  await page.goto("/anomalies");

  // AC1: non-null date rendered via formatTaiwanDate (2026-10-18 -> 2026年10月18日).
  // getByText(...).first() because the desktop <table> and the mobile <ul>
  // card list (anomaly-table.tsx) both render the same okRows at once --
  // CSS (hidden/md:table, md:hidden) controls which is visible, but both
  // are present in the DOM, which makes an unscoped exact-text locator
  // ambiguous under Playwright's strict mode.
  await expect(page.getByText("2026年10月18日").first()).toBeVisible();

  // AC2: date=null (governance_gap, ok row) shows 持續中 instead of blank/null.
  await expect(page.getByText("持續中").first()).toBeVisible();

  // AC3: agent / anomaly_type (localized) / reason each shown for ok rows.
  await expect(page.getByText("sales-copilot").first()).toBeVisible();
  await expect(page.getByText("工具重試迴圈").first()).toBeVisible();
  await expect(page.getByText("連續 5 次工具呼叫重試").first()).toBeVisible();
  await expect(page.getByText("finance-assistant").first()).toBeVisible();
  await expect(page.getByText("治理缺口").first()).toBeVisible();
  await expect(page.getByText("尚未登錄 Agent registry").first()).toBeVisible();

  // AC4: status="error" rows must not be silently omitted -- surfaced via a
  // banner above the table, including the affected agent (or a clear
  // placeholder when agent is null) and the reason.
  await expect(page.getByText("ops-bot")).toBeVisible();
  await expect(page.getByText("查詢觀測性後端逾時")).toBeVisible();
  await expect(page.getByText("不明")).toBeVisible();
  await expect(page.getByText("整批治理缺口規則執行失敗")).toBeVisible();
});

test("AC4: multiple error rows with mixed null/non-null agents each render their own distinct banner", async ({
  page,
}) => {
  await page.route("**/api/anomalies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        anomalies: [
          {
            agent: "ops-bot",
            anomaly_type: "night_batch_burst",
            date: null,
            status: "error",
            reason: "查詢觀測性後端逾時",
          },
          {
            agent: null,
            anomaly_type: "governance_gap",
            date: null,
            status: "error",
            reason: "整批治理缺口規則執行失敗",
          },
        ],
      }),
    });
  });

  await page.goto("/anomalies");

  // AC4: neither affected agent is silently omitted -- each error row gets
  // its own banner element (not merged into a single banner, and the
  // null-agent row still gets a banner with a placeholder, not a dropped row).
  const banners = page.locator(".border-red-300");
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText("ops-bot");
  await expect(banners.nth(0)).toContainText("查詢觀測性後端逾時");
  await expect(banners.nth(1)).toContainText("不明");
  await expect(banners.nth(1)).toContainText("整批治理缺口規則執行失敗");

  // No ok rows in this fixture, so the table/card list must not render at all.
  await expect(page.locator("table")).toHaveCount(0);
});

test("AC3: all 5 localized anomaly_type labels render correctly for ok rows", async ({
  page,
}) => {
  await page.route("**/api/anomalies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        anomalies: [
          { agent: "a1", anomaly_type: "tool_retry_loop", date: "2026-10-18", status: "ok", reason: "r1" },
          { agent: "a2", anomaly_type: "context_bloat", date: "2026-10-18", status: "ok", reason: "r2" },
          { agent: "a3", anomaly_type: "night_batch_burst", date: "2026-10-18", status: "ok", reason: "r3" },
          { agent: "a4", anomaly_type: "model_switch", date: "2026-10-18", status: "ok", reason: "r4" },
          { agent: "a5", anomaly_type: "governance_gap", date: null, status: "ok", reason: "r5" },
        ],
      }),
    });
  });

  await page.goto("/anomalies");

  for (const label of ["工具重試迴圈", "情境膨脹", "非營業時段流量暴增", "模型切換", "治理缺口"]) {
    await expect(page.getByText(label).first()).toBeVisible();
  }
});

test("anomalies page shows an empty-state message when there are zero anomalies", async ({
  page,
}) => {
  await page.route("**/api/anomalies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ anchor_date: "2026-10-20", anomalies: [] }),
    });
  });

  await page.goto("/anomalies");

  await expect(page.getByText("目前沒有異常")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.locator(".border-red-300")).toHaveCount(0);
});

test("mobile viewport: card list view also honors AC1-AC4 (date/ongoing, agent, anomaly type, reason, error banner)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route("**/api/anomalies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        anomalies: [
          {
            agent: "sales-copilot",
            anomaly_type: "tool_retry_loop",
            date: "2026-10-18",
            status: "ok",
            reason: "連續 5 次工具呼叫重試",
          },
          {
            agent: "finance-assistant",
            anomaly_type: "governance_gap",
            date: null,
            status: "ok",
            reason: "尚未登錄 Agent registry",
          },
          {
            agent: "ops-bot",
            anomaly_type: "night_batch_burst",
            date: null,
            status: "error",
            reason: "查詢觀測性後端逾時",
          },
        ],
      }),
    });
  });

  await page.goto("/anomalies");

  // Desktop <table> must actually be hidden (not just visually offscreen) at
  // this viewport width -- otherwise the assertions below could pass against
  // the table instead of the <ul> card list, masking a mobile-view bug.
  await expect(page.locator("table")).toBeHidden();

  // AC1/AC2/AC3 inside the mobile card list. Scoped to the <ul> (the desktop
  // <table> is `hidden` via CSS at this viewport, but both are still present
  // in the DOM -- see the earlier desktop test's note on strict-mode
  // ambiguity for the same reason).
  const cardList = page.getByRole("list");
  await expect(cardList.getByText("2026年10月18日")).toBeVisible();
  await expect(cardList.getByText("持續中")).toBeVisible();
  await expect(cardList.getByText("sales-copilot")).toBeVisible();
  await expect(cardList.getByText("工具重試迴圈")).toBeVisible();
  await expect(cardList.getByText("連續 5 次工具呼叫重試")).toBeVisible();

  // AC4: the error banner is not a responsive component (no hidden/md:hidden
  // classes in anomaly-error-banner.tsx) and must still surface on mobile.
  await expect(page.getByText("ops-bot")).toBeVisible();
  await expect(page.getByText("查詢觀測性後端逾時")).toBeVisible();
});
