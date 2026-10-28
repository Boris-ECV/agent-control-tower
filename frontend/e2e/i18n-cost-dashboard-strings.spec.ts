import { expect, test } from "@playwright/test";

test("cost dashboard 靜態文字在 i18n 重構後維持不變", async ({ page }) => {
  await page.goto("/cost-dashboard");

  // The sticky header no longer duplicates the sidebar's product title
  // (SDLCCT-68); the sidebar nav (components/layout/app-sidebar.tsx) remains
  // the sole place "Agent Control Tower" is rendered.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();
  await expect(page.getByRole("heading", { name: "成本總覽" })).toBeVisible();
  await expect(
    page.getByText("本月成本 vs 預算、預估月底超支、跨 Agent 期間比較"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本月成本 vs 預算總覽" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "跨 Agent 期間比較（誰漲最多）" }),
  ).toBeVisible();
  await expect(
    page.getByText("資料來源：Agent registry ＋ 觀測性後端成本查詢。"),
  ).toBeVisible();
  await expect(page).toHaveTitle("成本總覽 — Agent Control Tower");
});

test("app sidebar 導覽文字在 i18n 重構後維持不變", async ({ page }) => {
  await page.goto("/cost-dashboard");

  // exact: true avoids a strict-mode match against "成本總覽" / "本月成本
  // vs 預算總覽" headings, which both contain "總覽" as a substring.
  await expect(page.getByText("總覽", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "成本儀表板" })).toBeVisible();
  await expect(page.getByText("治理")).toBeVisible();
  await expect(page.getByText("Agent 清單")).toBeVisible();
  await expect(page.getByText("異常與告警")).toBeVisible();
  await expect(page.getByText("預算與節省模擬")).toBeVisible();
  await expect(page.getByText("政策引擎")).toBeVisible();
  await expect(page.getByText("核准流程")).toBeVisible();
  await expect(page.getByText("操作")).toBeVisible();
  await expect(page.getByText("暫停 Agent")).toBeVisible();
  await expect(page.getByText("緊急關閉")).toBeVisible();
  await expect(page.getByText("設定")).toBeVisible();
  await expect(page.getByRole("link", { name: "系統" })).toBeVisible();
});
