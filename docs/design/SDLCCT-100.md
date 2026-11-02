# 設計文件 — SDLCCT-100 狀態標籤改為底色、外框與色點的共用元件

## 對應需求規格

對應 SDLCCT-100（由 SDLCCT-82 拆分之 S9，約 1 開發日，G1 已核准）之 Gherkin
驗收條件：(1) 狀態標籤（如「正常」「異常」）需包含底色、外框與色點；(2)
標籤文字與底色對比 ≥ 4.5:1；(3) 既有各頁狀態標籤皆改用共用元件。範圍外：
不新增狀態種類、不改狀態判定邏輯。依賴 S8（SDLCCT-99，已 Done）定案的色彩
token。開放問題：無。

**現況盤點**（實作前已逐一確認的程式碼事實，依規格背景「實作時須先盤點
既有狀態呈現位置」要求）：

- `frontend/app/agents/page.tsx` 第 76–86 行 `GovernanceBadge`：唯一在程式
  碼中字面對應規格範例「正常」/「異常」的元件——`frontend/lib/i18n/
  messages.ts` 第 88 行 `agents.governanceBadge.ok: "正常"`、第 87 行
  `hasGap: "治理缺口"`（異常態）。目前樣式：異常態
  `rounded-full border border-red-300 bg-red-50 ... text-red-700`；正常態
  `rounded-full border border-border bg-gray-50 ... text-text-secondary`。
  **無色點**，不符合 AC1。兩個呼叫端：桌面表格列第 125 行、行動卡片列表
  第 165 行，皆需改用共用元件。
- `frontend/components/cost-overview/summary-section.tsx` 第 88–98 行：
  治理缺口彙總標籤，依 `summary.unregistered.agents.length > 0` 在
  `hasGap`/`noGap` 兩段文案間切換（`messages.ts` 第 56–57 行），但**目前
  樣式不論布林值為何皆固定渲染 `border-red-300 bg-red-50 text-red-700`**
  （只有文字內容切換，顏色未跟著狀態切換）——這是既有的樣式與判定結果不
  同步的瑕疵，正是 AC1/AC3 要求標籤樣式對應狀態的字面情境，套用共用元件
  後依布林值正確切換 success/danger 兩個 variant，同一個布林值計算方式不
  變（不算改動「狀態判定邏輯」，只修正其視覺呈現）。此處也需改用共用元
  件。
- 下列三處**判定為不屬於本規格「狀態標籤」範圍，不migrate**（理由各自列
  出，供日後讀者理解邊界，而非遺漏）：
  - `summary-section.tsx` 第 108 行 `unregisteredBadge`（「未登錄」）：
    此標籤只出現在已經被篩選為「未登錄」的 agent 清單中，同一位置永遠不
    會出現「已登錄」的對應態切換渲染——它是靜態分類標記，不是會在
    正常/異常兩態間切換的健康狀態指示，不符合 AC1 範例「正常/異常」這
    種二元可切換狀態的語意。
  - `period-comparison-section.tsx` 第 77 行 `notableNewSpendBadge`
    （「新增顯著支出」）：這是對金額數字的補充註記（標註前期花費過低
    使百分比不具意義），不是某個實體的狀態指示，同樣沒有二元切換。
  - `summary-section.tsx` 第 24–25 行 `Card` 的 `danger` 紅字（無底色/外
    框/色點結構，僅文字變色）：不符合 AC1「標籤包含底色、外框與色點」
    的結構要求，本身就不是一個「標籤」，不在 AC3「既有狀態標籤」字面範
    圍內。
  - `frontend/components/agent-detail/version-cost-chart.tsx` 第 458 行
    的 `rounded-full` 色點：圖表圖例色點，語意與色票由
    `docs/design-system.md` 第 11 節資料視覺化分類色票規範管轄，與本
    Story「狀態」語意無關，不在範圍內。
  - `frontend/components/anomalies/anomaly-table.tsx`、
    `anomaly-error-banner.tsx`：全文 grep 確認異常列表本身不含任何顏色態
    標籤（僅純文字異常類型），`anomaly-error-banner.tsx` 的紅色區塊是整
    頁級錯誤訊息卡片（fetch 失敗時渲染），不是某實體的狀態標籤，不在範
    圍內。
- `docs/design-system.md` 第 1 節目前只有 5 個中性/強調色 token，**未定義
  任何 success/danger 語意色 token**；既有程式碼的紅色標籤（`red-300`/
  `red-50`/`red-700`）皆直接寫 Tailwind 調色盤 utility class，未經過
  `--color-*` token 間接層。本 Story 延續此既有慣例（見下方關鍵決策 1）。
- **跨元素樣式耦合測試檢查**（流程第 4 步）：於 `frontend/e2e/` 搜尋
  `getComputedStyle`/`toEqual.*[Ss]tyle`/「一致」，命中
  `trace-detail.spec.ts:114-116`（儲存格 `paddingLeft`）、
  `agents.spec.ts:176,221,244,256,260`（箭頭 `translate`/`color` 動效，
  SDLCCT-101 既有驗證）、`agent-detail.spec.ts:895-951,1474,1556`（同類
  箭頭動效與 `pointerEvents`）、`currency-rollout.acceptance.spec.ts:29`、
  `breadcrumbs.spec.ts:140`（`textOverflow`）——全部比較對象皆非顏色
  （padding/translate/pointerEvents/textOverflow），且皆非本 Story 要改
  動的 `GovernanceBadge`/治理缺口彙總標籤選擇器。另外確認
  `anomalies.spec.ts:158,211` 的 `.border-red-300` 計數斷言，鎖定對象是
  `/anomalies` 頁面的 `anomaly-error-banner.tsx`（本 Story 不碰該元件、
  不在同一頁面），與本 Story 改動的 `/agents`、`/`（cost-overview）頁面
  選擇器無關。**未發現**任何將本 Story 要改動的選擇器與另一元件計算樣式
  綁定相等的鏈式耦合測試。

## 介面/API 契約

無。本 Story 純前端樣式/元件調整，不涉及任何 HTTP 端點或 request/response
格式變更。

## 資料模型

無新增資料模型。不涉及任何資料表、欄位、索引（規格範圍外已明文「不改狀態
判定邏輯」，本設計亦不改動任何既有判定布林值的計算方式，只改其視覺呈現）。

## 關鍵技術決策

### 1. 新增共用元件 `StatusBadge`，路徑 `frontend/components/common/status-badge.tsx`

沿用 SDLCCT-101 已建立的 `frontend/components/common/` 慣例（跨頁共用、非
`ui/` shadcn 生成目錄的互動/顯示元件放此處，`clickable-row.tsx` 即為同一
慣例的前例）。元件簽名：

```tsx
export type StatusVariant = "success" | "danger";

export function StatusBadge({
  variant,
  children,
}: {
  variant: StatusVariant;
  children: ReactNode;
}): JSX.Element;
```

渲染輸出（概念示意，實作細節由 developer 依此決定 class 組合）：

```tsx
<span className={cn(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
  variant === "success"
    ? "border-border bg-gray-50 text-text-secondary"
    : "border-red-300 bg-red-50 text-red-700",
)}>
  <span
    aria-hidden="true"
    className={cn(
      "h-1.5 w-1.5 flex-none rounded-full",
      variant === "success" ? "bg-text-secondary" : "bg-red-600",
    )}
  />
  {children}
</span>
```

理由：(1) `variant` 只開兩個值 `"success"|"danger"`，對應規格範例「正常」/
「異常」二元狀態，不多開第三種（範圍外「不新增狀態種類」）；(2) 顏色延續
既有 `GovernanceBadge` 已使用的 Tailwind 調色盤 class（`red-300`/`red-50`/
`red-700` 異常態；`border`/`gray-50`/`text-secondary` 正常態），不新增
`docs/design-system.md` 色彩 token——理由是既有紅色標籤本來就不經過
`--color-*` token 層，本 Story 範圍是「把分散的樣式收斂成一個共用元件」，
不是「重新設計狀態色票系統」，沿用現有色值可最大化保留既有視覺外觀、降低
風險，且色值本身已通過下方對比度驗證；(3) `children` 而非 `label: string`
——比照 `ClickableRow` 用 `children` 接收內容的既有慣例，呼叫端自行傳入已
翻譯文字（`t(...)` 回傳值），元件不內嵌任何文案字串。

### 2. 色點（dot）用純裝飾 `<span>`，非 `<svg>`

理由：色點只是一個純色圓點，用 `rounded-full` + 背景色的 `<span>` 即可達
成，不需要 SVG 的額外複雜度；加 `aria-hidden="true"` 因為色點是重複視覺資
訊（文字本身已傳達狀態），對螢幕閱讀器使用者不需要再唸出一次，比照
`docs/design-system.md` 既有「裝飾性圖形用 `aria-hidden`」慣例
（SDLCCT-90 面積填色規則即同一精神）。

### 3. 對比度驗證（依 `docs/design-system.md` 第 1 節同一相對亮度公式）

- **異常態**：`text-red-700` (#B91C1C) vs `bg-red-50` (#FEF2F2)——
  R=185,G=28,B=28 線性化後 L≈0.1124；背景 R=254,G=242,B=242 線性化後
  L≈0.9100；對比度 = (0.9100+0.05)/(0.1124+0.05) ≈ **5.91:1**（≥4.5:1，
  通過 AC2；此色值組合是既有 `GovernanceBadge` 異常態已經在用的配色，本
  次只是補驗證並收斂進共用元件，數值本身未變動）。
- **正常態**：`text-text-secondary` (#475467) vs `bg-gray-50` (#F9FAFB)——
  `docs/design-system.md` 已驗證 `#475467` vs 純白 `#FFFFFF` 為 7.68:1；
  `#F9FAFB` 比純白略暗但差異極小（R=249,G=250,B=251），線性化後
  L≈0.9757；對比度 = (0.9757+0.05)/(0.0868+0.05) ≈ **7.50:1**（≥4.5:1，
  通過 AC2，且仍超過 AAA 7:1 門檻）。
- 色點本身是裝飾性色塊而非文字，不套用文字對比門檻（比照
  `docs/design-system.md` 第 1 節「`--color-border` 不是文字色，不套用文
  字對比門檻」同一原則），不需驗證色點與底色的對比。

兩個 variant 皆通過 AC2 的 4.5:1 門檻，驗證記錄於此。

### 4. 套用範圍：3 個既有呼叫端改用 `StatusBadge`，其餘既有紅色元素不動

依上方「現況盤點」已列出的判斷依據，實際需要修改的呼叫端共 3 處：
`frontend/app/agents/page.tsx` 第 125、165 行（`GovernanceBadge` 桌面表格
列與行動卡片列表，`hasGap ? "danger" : "success"`），以及
`frontend/components/cost-overview/summary-section.tsx` 第 90 行治理缺口
彙總標籤（`summary.unregistered.agents.length > 0 ? "danger" : "success"`）
。`GovernanceBadge` 函式本身可保留（內部改為呼叫 `StatusBadge` 並傳入對應
variant 與文字），或由 developer 評估直接在呼叫端 inline 改用
`StatusBadge`、移除 `GovernanceBadge`——兩種做法皆滿足 AC3，細節留給
developer 依實作時的程式碼簡潔度判斷，不是本設計需要定案的決策點（不影響
任何外部可觀察行為或測試斷言）。

## UI 原型

見 `docs/design/SDLCCT-100-prototype.html`（可直接在瀏覽器開啟），並列呈
現 `StatusBadge` 的 `success`（正常，灰底＋灰外框＋灰色點）與 `danger`
（異常，紅底＋紅外框＋紅色點）兩種狀態，並標示各自計算後的文字對比度數
值（對應上方「關鍵技術決策 3」的驗證結果），另附一組「套用後」示意（治理
缺口彙總標籤在 `hasGap`/`noGap` 兩種情境下正確切換樣式，對照現況盤點指出
的既有瑕疵修正前後差異）。

## 開放設計問題（定稿時必須為空）

無
