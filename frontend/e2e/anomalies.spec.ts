import { expect, test } from "@playwright/test";

test("anomalies page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/anomalies");

  // Scoped to <header> because the sidebar nav (components/layout/app-sidebar.tsx)
  // also renders the literal text "Agent Control Tower", which makes the
  // unscoped locator ambiguous under Playwright's strict mode (see
  // agents.spec.ts / cost-dashboard.spec.ts).
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toBeVisible();
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
