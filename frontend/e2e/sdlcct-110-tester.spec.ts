import { expect, test } from "@playwright/test";

// Tester-authored, independent e2e verification of SDLCCT-110's Gherkin
// acceptance criteria, written without reusing the developer's own
// e2e/agent-detail.spec.ts fixtures (different trace ids / timestamps),
// run against a real browser via Playwright rather than jsdom.

const MOCK_KEY = "qa-independent-agent";

test("AC1: a legal UUIDv7 trace id renders its parsed minute-precision Taiwan-time execution start time", async ({
  page,
}) => {
  // Independently chosen timestamp: 2025-06-01T23:45:00.000Z ->
  // 2025/06/02 07:45 in Asia/Taipei (UTC+8).
  const ms = Date.UTC(2025, 5, 1, 23, 45, 0);
  const hex12 = ms.toString(16).padStart(12, "0");
  const validId = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7fff-8aaa-999999999999`;

  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "QA Independent Agent",
        anchor_date: "2025-06-05",
        period_start: "2025-05-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: validId, total_estimated_cost: 77.5, metadata: null }],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  await expect(page.getByText("2025/06/02 07:45")).toBeVisible();
});

test("AC2: an unparseable trace id shows em dash in the execution-time column, without breaking the cost or id cells in the same row", async ({
  page,
}) => {
  const invalidId = "this-is-clearly-not-a-uuid";

  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "QA Independent Agent",
        anchor_date: "2025-06-05",
        period_start: "2025-05-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: invalidId, total_estimated_cost: 13.0, metadata: null }],
      }),
    });
  });

  await page.goto(`/agents/${MOCK_KEY}`);

  // invalidId is 26 chars (> 12), so SDLCCT-110's truncation also applies
  // to it: displayed as front-8…last-4, full id only in the title attr.
  const truncatedInvalidId = `${invalidId.slice(0, 8)}…${invalidId.slice(-4)}`;
  const row = page.locator("tr", { hasText: truncatedInvalidId });
  // Column order: Trace ID / 執行時間 / 預估成本 / 中繼資料 / arrow decoration.
  await expect(row.locator("td").nth(1)).toHaveText("—");
  await expect(row.getByText(truncatedInvalidId)).toHaveAttribute("title", invalidId);
  await expect(row.getByText("US$ 13.00")).toBeVisible();
});

test("AC3: a full 36-char trace id truncates, hover reveals the full id via title, and the copy button copies the untruncated id without navigating away", async ({
  page,
}) => {
  const fullId = "0188abcd-1234-7def-9abc-fedcba987654";

  await page.route(`**/api/agents/${MOCK_KEY}/cost-breakdown`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: MOCK_KEY,
        display: "QA Independent Agent",
        anchor_date: "2025-06-05",
        period_start: "2025-05-01",
        version_cost_series: [],
        model_cost_breakdown: [],
        top_traces: [{ id: fullId, total_estimated_cost: 5.0, metadata: null }],
      }),
    });
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto(`/agents/${MOCK_KEY}`);

  const truncated = "0188abcd…7654";
  await expect(page.getByText(truncated)).toBeVisible();
  await expect(page.getByText(fullId)).toHaveCount(0);
  await expect(page.getByText(truncated)).toHaveAttribute("title", fullId);

  const copyButton = page.getByRole("button", { name: "複製完整 Trace ID", exact: true });
  await copyButton.click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(fullId);

  // Real mouse click on the copy button must not have triggered the row's
  // own navigate-to-trace-detail behaviour (SDLCCT-101 compat, checked here
  // with an actual Playwright click rather than a DOM event dispatch).
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}`);

  // Sanity check that row navigation genuinely still works elsewhere in the
  // same row (clicking a non-button cell) -- this is what SDLCCT-101 scope
  // requires remain unbroken.
  await page.route(`**/api/agents/${MOCK_KEY}/traces/${encodeURIComponent(fullId)}/spans`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ key: MOCK_KEY, trace_id: fullId, spans: [] }),
    });
  });
  const costCell = page.getByText("US$ 5.00");
  await costCell.click();
  await expect(page).toHaveURL(`/agents/${MOCK_KEY}/traces/${encodeURIComponent(fullId)}`);
});
