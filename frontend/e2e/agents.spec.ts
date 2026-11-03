import { expect, test } from "@playwright/test";

test("agents page loads and shows the expected static content", async ({
  page,
}) => {
  await page.goto("/agents");

  // The sticky header no longer duplicates the sidebar's product title
  // (SDLCCT-68); the sidebar nav (components/layout/app-sidebar.tsx) remains
  // the sole place "Agent Control Tower" is rendered.
  await expect(
    page.locator("header").getByText("Agent Control Tower"),
  ).toHaveCount(0);
  await expect(page.getByText("Agent Control Tower")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent 清單" }),
  ).toBeVisible();
});

test("sidebar Agent 清單項目可導覽至 /agents", async ({ page }) => {
  await page.goto("/cost-dashboard");

  await page.getByRole("link", { name: "Agent 清單" }).click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("heading", { name: "Agent 清單" }),
  ).toBeVisible();
});

test("sidebar Agent 清單項目在導覽後顯示 active 樣式狀態", async ({ page }) => {
  await page.goto("/cost-dashboard");

  const agentListLink = page.getByRole("link", { name: "Agent 清單" });
  const costDashboardLink = page.getByRole("link", { name: "成本儀表板" });

  // Before navigating to /agents, the Agent 清單 item must not be marked
  // active (components/ui/sidebar.tsx's SidebarMenuButton only renders the
  // data-active attribute at all when isActive is true, which app-sidebar.tsx
  // derives from isNavItemActive(pathname, href); when false the attribute is
  // simply absent from the DOM, and when true it's present as an empty
  // boolean attribute, i.e. `data-active=""`).
  await expect(agentListLink).not.toHaveAttribute("data-active");
  await expect(costDashboardLink).toHaveAttribute("data-active");

  await agentListLink.click();
  await expect(page).toHaveURL(/\/agents$/);

  // After navigating, the clicked item becomes active and the
  // previously-active item (Cost Dashboard) becomes inactive.
  await expect(agentListLink).toHaveAttribute("data-active");
  await expect(costDashboardLink).not.toHaveAttribute("data-active");
});

test("AC1: clicking an agent row navigates to that agent's detail page", async ({
  page,
}) => {
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: "alice",
            budget: 1000,
            current_period_spend: 500,
            budget_consumed_pct: 50,
            has_governance_gap: false,
            registered: true,
            trend: [{ date: "2026-10-18", value: 100 }],
          },
        ],
      }),
    });
  });

  await page.goto("/agents");

  // Desktop table row -- scoped to <table> since the mobile <ul> card list
  // for the same agent is also present in the DOM (hidden via CSS, not
  // removed), which would otherwise make the row locator ambiguous.
  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toHaveAttribute("aria-label", "Sales Copilot");

  await firstRow.click();

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});

test("AC1: mobile viewport -- clicking an agent card also navigates to that agent's detail page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: "alice",
            budget: 1000,
            current_period_spend: 500,
            budget_consumed_pct: 50,
            has_governance_gap: false,
            registered: true,
            trend: [{ date: "2026-10-18", value: 100 }],
          },
        ],
      }),
    });
  });

  await page.goto("/agents");

  // Mobile card list (<ul> wrapped in a real <Link>) is the code path used
  // below the md breakpoint -- distinct from the desktop <tr onClick> path
  // covered above, so it needs its own navigation assertion.
  const card = page.getByRole("link", { name: "Sales Copilot" });
  await expect(card).toBeVisible();

  await card.click();

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});

async function mockSingleAgent(page: import("@playwright/test").Page) {
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: "alice",
            budget: 1000,
            current_period_spend: 500,
            budget_consumed_pct: 50,
            has_governance_gap: false,
            registered: true,
            trend: [{ date: "2026-10-18", value: 100 }],
          },
        ],
      }),
    });
  });
}

test("SDLCCT-94: desktop table amounts use two decimals, right-aligned with tabular-nums", async ({
  page,
}) => {
  await mockSingleAgent(page);
  await page.goto("/agents");

  for (const text of ["US$ 1,000.00", "US$ 500.00"]) {
    const cell = page.locator("table tbody td", { hasText: text });
    await expect(cell).toBeVisible();
    const style = await cell.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { align: cs.textAlign, numeric: cs.fontVariantNumeric };
    });
    expect(style.align).toBe("right");
    expect(style.numeric).toContain("tabular-nums");
  }
});

test("SDLCCT-101 AC2: keyboard Enter on a focused agent row navigates to its detail page", async ({
  page,
}) => {
  await mockSingleAgent(page);
  await page.goto("/agents");

  const firstRow = page.locator("table tbody tr").first();
  await firstRow.focus();
  await expect(firstRow).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});

test("SDLCCT-101 AC2: keyboard Space on a focused agent row navigates to its detail page", async ({
  page,
}) => {
  await mockSingleAgent(page);
  await page.goto("/agents");

  const firstRow = page.locator("table tbody tr").first();
  await firstRow.focus();
  await expect(firstRow).toBeFocused();
  await page.keyboard.press(" ");

  await expect(page).toHaveURL(/\/agents\/sales-copilot$/);
});

test("SDLCCT-101 AC3: a focused agent row shows a clear focus outline", async ({ page }) => {
  await mockSingleAgent(page);
  await page.goto("/agents");

  const firstRow = page.locator("table tbody tr").first();
  await firstRow.focus();
  await expect(firstRow).toBeFocused();

  const outline = await firstRow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
  });
  // docs/design-system.md §8 token: outline: 2px solid var(--color-accent)
  // (#2563EB = rgb(37, 99, 235)).
  expect(outline.width).toBe("2px");
  expect(outline.style).toBe("solid");
  expect(outline.color).toBe("rgb(37, 99, 235)");
});

test("SDLCCT-101 AC1: hovering an agent row shows the hover background and shifts/colors the trailing arrow", async ({
  page,
}) => {
  await mockSingleAgent(page);
  await page.goto("/agents");

  const firstRow = page.locator("table tbody tr").first();
  const arrow = firstRow.locator("svg").last();

  // Tailwind v4's translate-x-* utility sets the native CSS `translate`
  // property (not the legacy `transform` composite), so that -- not
  // `transform` -- is what group-hover:translate-x-1 changes here.
  const before = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { translate: cs.translate, color: cs.color };
  });

  await firstRow.hover();

  // Poll on `translate` specifically (not the combined object): `color`
  // settles via a CSS transition on the main thread slightly before the
  // compositor-driven `translate` property reflects in getComputedStyle,
  // so polling the pair together can pass on the color change alone while
  // translate is still mid-flight.
  await expect
    .poll(async () => arrow.evaluate((el) => getComputedStyle(el).translate))
    .not.toBe("none");

  const after = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { translate: cs.translate, color: cs.color };
  });
  // Arrow becomes the accent color and shifts right (non-zero translate) on
  // hover; default state has no translate (translate-x-1 applies only on
  // hover/focus).
  expect(before.translate).toBe("none");
  expect(after.color).toBe("rgb(37, 99, 235)");
  expect(after.translate).not.toBe("none");
});

test("SDLCCT-94: mobile agent card shows the same two-decimal amounts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSingleAgent(page);
  await page.goto("/agents");

  const card = page.getByRole("link", { name: "Sales Copilot" });
  await expect(card.getByText("US$ 1,000.00")).toBeVisible();
  await expect(card.getByText("US$ 500.00")).toBeVisible();
});

// SDLCCT-105 Scenario "未登錄資料視覺區分": owner/budget 為 null 時顯示淡色佔位文字，
// 與有實際資料的一般文字顏色明顯區分（以 getComputedStyle 的 color 實測，
// 不依賴 class 字串，驗證最終渲染結果而非實作細節）。
test("SDLCCT-105: null owner/budget show faded placeholder text, visually distinct from populated text color", async ({
  page,
}) => {
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-20",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: null,
            budget: null,
            current_period_spend: 500,
            budget_consumed_pct: null,
            has_governance_gap: false,
            registered: true,
            trend: [],
          },
          {
            key: "support-bot",
            display: "Support Bot",
            dept: "Support",
            owner: "bob",
            budget: 2000,
            current_period_spend: 300,
            budget_consumed_pct: 15,
            has_governance_gap: false,
            registered: true,
            trend: [],
          },
        ],
      }),
    });
  });

  await page.goto("/agents");

  const ownerPlaceholder = page.locator("table tbody td", { hasText: "未指定" });
  const budgetPlaceholder = page.locator("table tbody td", { hasText: "未設定" });
  await expect(ownerPlaceholder).toBeVisible();
  await expect(budgetPlaceholder).toBeVisible();

  const populatedOwnerCell = page.locator("table tbody tr", { hasText: "Support Bot" }).locator("td").nth(2);
  await expect(populatedOwnerCell).toHaveText("bob");

  const placeholderColor = await ownerPlaceholder
    .locator("span")
    .evaluate((el) => getComputedStyle(el).color);
  const populatedColor = await populatedOwnerCell.evaluate((el) => getComputedStyle(el).color);

  expect(placeholderColor).not.toBe(populatedColor);
});

// SDLCCT-105 Scenario "本期期間標示": 表格下方顯示本期對應的日期區間註腳
// （以 period_start 至 anchor_date 表示）。
test("SDLCCT-105: the agents table footer shows the current-period date range footnote", async ({
  page,
}) => {
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anchor_date: "2026-10-31",
        period_start: "2026-10-01",
        agents: [
          {
            key: "sales-copilot",
            display: "Sales Copilot",
            dept: "Sales",
            owner: "alice",
            budget: 1000,
            current_period_spend: 500,
            budget_consumed_pct: 50,
            has_governance_gap: false,
            registered: true,
            trend: [],
          },
        ],
      }),
    });
  });

  await page.goto("/agents");

  await expect(page.locator("footer").getByText("本期（10/1–10/31）")).toBeVisible();
});
