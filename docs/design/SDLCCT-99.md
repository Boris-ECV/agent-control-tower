# 設計文件 — SDLCCT-99 側邊選單分類標題與次要文字色票調整以符合對比度

## 對應需求規格
對應 G1 已核准的需求規格「側邊選單分類標題與次要文字色票調整以符合對比度
（SDLCCT-82 拆分 S8，約 0.5 開發日）」。使用者故事：身為使用者，我希望次要
文字清楚易讀。3 條 AC：(1) 側邊選單分類標題文字色為 `#667085`；(2) 各頁次要
文字統一使用 `#475467`，作為共用 token 而非各處寫死；(3) 上述文字置於白底
對比度皆 ≥ 4.5:1。範圍外：不改狀態標籤（SDLCCT-100，依賴本票的色票
token）；不改主色票或深色模式。依賴：無。

## 現狀查核（實作前已讀取的既有程式碼）
- `frontend/app/globals.css`：`:root` 第 64-70 行是本專案「五個色彩 token
  唯一真實來源」（`docs/design-system.md` 第 1、9 節），其中
  `--color-text-secondary: #4b5563`（第 68 行）透過 shadcn 別名
  `--muted-foreground: var(--color-text-secondary)`（第 88 行）與 `@theme
  inline` 的 `--color-text-secondary: var(--muted-foreground)`（第 21 行）
  一路串接到 Tailwind utility class `text-text-secondary`／
  `text-muted-foreground`。目前**沒有**任何 token 對應規格要求的
  `#667085`，也沒有任何 token 對應 `#475467`——兩個色票在程式碼中都尚未
  出現（與規格「背景」段落一致）。
- `frontend/components/layout/app-sidebar.tsx`（第 73 行）：側邊選單分類
  標題 `<SidebarGroupLabel>{group.label}</SidebarGroupLabel>`，未傳入
  `className`，因此完全繼承 `SidebarGroupLabel` 的預設樣式。
- `frontend/components/ui/sidebar.tsx`（第 393-409 行，shadcn CLI 產生，
  SDLCCT-34 決策載明「元件檔案本身會被產生，留著不刪，避免手動修改 shadcn
  產生的程式碼」）：`SidebarGroupLabel` 預設 class 包含
  `text-sidebar-foreground/70`——即側欄前景色（別名指向
  `--color-text-primary`）疊加 70% 不透明度，**不是任何具名色彩 token**，
  也不等於 `#667085`。沿用既有慣例（不修改 shadcn 產生檔案），本次調整在
  `app-sidebar.tsx` 呼叫端用 `className` 覆寫，而非改 `sidebar.tsx`。
- `frontend/components/layout/breadcrumbs.tsx`（第 39、45 行）、
  `page-header-timestamp.tsx`（第 28 行）：均使用 Tailwind utility class
  `text-text-secondary`（而非直接寫 hex），這正是規格 AC2「作為共用
  token 而非各處寫死」目前已採用的既有慣例——`Grep` 確認全站共 18 個檔案
  使用 `text-text-secondary`／`text-muted-foreground`，本次只需改 token
  定義本身的值，不需逐一修改各頁呼叫端。
- `docs/design-system.md` 第 1 節色彩 token 表與第 48-53 行「如何驗證」
  段落明文：「若未來新增 token 或改變既有色值，必須用同一公式…重新計算並
  記錄比例於該次改動的設計文件/PR 描述中」——本設計文件下方「關鍵技術
  決策」即依此公式驗證。
- 跨元素樣式耦合測試檢查（依流程第 4 步）：`Grep` 全站
  `getComputedStyle`/`toEqual.*[Ss]tyle`/「一致」於 `frontend/e2e/`、
  `frontend/components/**/*.test.tsx`，命中 7 個檔案，逐一檢視後**沒有
  任何測試比較兩個元素的顏色（`color`）是否相等**——命中的斷言皆為
  `textAlign`／`fontVariantNumeric`／`paddingLeft`／`pointerEvents`／
  `textOverflow` 等非顏色屬性（`frontend/e2e/agents.spec.ts:176`、
  `currency-rollout.acceptance.spec.ts:29`、`trace-detail.spec.ts:114-116`、
  `agent-detail.spec.ts:1339,1421`、`breadcrumbs.spec.ts:140`）。本 repo
  目前無任何既有「兩元素顏色必須相等」的鏈式耦合測試，本次調整不涉及此
  風險。

## 介面/API 契約
無。本 Story 純前端樣式調整，不涉及任何 HTTP 端點或 request/response
格式變更。

## 資料模型
無新增資料模型。本 Story 不碰任何資料表、欄位、索引。

## 關鍵技術決策

### 1. 新增 `--color-text-tertiary` token 承載 `#667085`，而非就地覆寫既有 token
`docs/design-system.md` 第 1 節目前只有 5 個色彩 token，其中
`--color-text-primary`（#1F2937）、`--color-text-secondary`（即將改為
#475467）皆有既定用途，皆不等於 `#667085`。決策：新增第 6 個 token
`--color-text-tertiary: #667085`，專供側邊選單分類標題使用，並在
`frontend/app/globals.css` 的 `:root` 與 `@theme inline` 依現有
`--color-text-secondary` 的寫法新增對應行（`@theme inline` 內
`--color-text-tertiary: var(--color-text-tertiary);` 讓 Tailwind 產生
`text-text-tertiary` utility class）：

```css
/* :root */
--color-text-tertiary: #667085;

/* @theme inline */
--color-text-tertiary: var(--color-text-tertiary);
```

理由：(1) AC1 只要求分類標題文字色為 `#667085`，沒有要求與 AC2 的次要文字
共用同一個 token——兩者是規格明確列出的兩個獨立 Scenario、兩個獨立色值，
合併成一個 token 會讓未來任何一方單獨調色時互相牽連，不是規格要求的範圍；
(2) 比照本專案既有「新色值進 token，不寫死」的慣例（`docs/design-system.md`
第 9 節決策理由：避免兩套色彩系統互相漂移），新色值一律先進 token 再被
元件引用，與 AC2「作為共用 token 而非各處寫死」同一精神，雖然 AC2 文字上
只明文要求次要文字如此，但分類標題既然也是「跨頁可能重複出現的語意色」
（本 Story 範圍內僅側邊選單一處，但命名不綁死在 sidebar，方便未來若有
其他分類標題沿用），比照辦理不算超出規格的額外設計。

### 2. `--color-text-secondary` 改值為 `#475467`（就地修改既有 token，不新增）
`globals.css`、`docs/design-system.md` 第 1 節表格中
`--color-text-secondary` 的值由 `#4b5563` 改為 `#475467`。理由：AC2 明文
要求「次要文字」「統一使用 `#475467`，作為共用 token 而非各處寫死」——
本專案的「次要文字」語意色正是既有 `--color-text-secondary`（已被
`text-text-secondary`/`text-muted-foreground` 18 處引用，見上方現狀查核），
不需要新增第二個次要文字 token；直接改這一個 token 的值，所有既有引用點
全站自動套用新色，不需逐一修改各頁呼叫端程式碼，正是 AC2「而非各處寫死」
的字面意思。`docs/design-system.md` 第 48-53 節已預先為此類「改既有 token
色值」的情境定義流程（本文件下方對比度驗證即依該公式計算）。

### 3. 側邊選單分類標題：在 `app-sidebar.tsx` 呼叫端用 `className` 覆寫，不修改 `sidebar.tsx`
`frontend/components/layout/app-sidebar.tsx` 第 73 行
`<SidebarGroupLabel>{group.label}</SidebarGroupLabel>` 改為
`<SidebarGroupLabel className="text-text-tertiary">{group.label}</SidebarGroupLabel>`。
`SidebarGroupLabel` 內部以 `cn(DEFAULT_CLASSES, className)`
（`frontend/components/ui/sidebar.tsx` 第 399-408 行）合併 class，
`cn` 底層為 `clsx` + `tailwind-merge`，`tailwind-merge` 會讓後傳入的
`text-text-tertiary` 覆寫掉預設 class 中互斥的 `text-sidebar-foreground/70`
文字色 class，其餘（`h-8`、`font-medium` 等排版 class）維持不變。理由：
沿用 SDLCCT-34 既定決策「shadcn 產生的元件檔案本身留著不刪、避免手動修改」
——顏色調整透過呼叫端 `className` 覆寫即可達成，不需要碰
`sidebar.tsx`，也不影響 `SidebarGroupLabel` 在其他未來用途（若有）的預設
樣式。

### 4. 對比度驗證（依 `docs/design-system.md` 第 1 節同一相對亮度公式）
- `#667085` vs `#FFFFFF`：R=102,G=112,B=133 → 線性化後
  L ≈ 0.1611 → 對比度 = (1.0+0.05)/(0.1611+0.05) ≈ **4.97:1**（≥ 4.5:1，
  通過 AC3；比 `docs/design/references/ui-review-v2/design-changes-v2.md`
  估算的「約 4.8:1」更精確，數值不同純因估算精度，結論一致：通過門檻但
  不算寬裕，不可再調深背景或調淺文字）。
- `#475467` vs `#FFFFFF`：R=71,G=84,B=103 → 線性化後 L ≈ 0.0868 →
  對比度 = (1.05)/(0.0868+0.05) ≈ **7.68:1**（≥ 4.5:1，通過 AC3，且超過
  AAA 7:1，與現行 `#4b5563` 的 7.56:1 同級，改色後可讀性不劣化）。

兩者皆通過 AC3 的 4.5:1 門檻，驗證記錄於此，依 `docs/design-system.md`
第 48-53 行流程，不需重算既有其餘 token 配對（主色票、accent、border 未
變動）。

### 5. 範圍邊界：不處理狀態標籤、不處理深色模式
沿用規格「範圍外」明文：狀態標籤的色票調整留給 SDLCCT-100（該票依賴本票
在此定案的 `--color-text-tertiary`/`--color-text-secondary` token 名稱與
值，但本票不預先設計狀態標籤要怎麼用它們——那是 SDLCCT-100 自己的設計
範圍）；`.dark` 區塊的對應色值本故事不碰（`docs/design-system.md` 全文
無深色模式章節，比照 SDLCCT-34 同類決策）。

## UI 原型
`docs/design/SDLCCT-99-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，
內嵌 `<style>`，並列呈現「調整前」（`#4b5563` 次要文字、
`text-sidebar-foreground/70` 分類標題）與「調整後」（`#475467` 次要文字、
`#667085` 分類標題）兩組對照，皆置於白底 `#FFFFFF`，並標示各自的計算後
對比度數值，對應上方「關鍵技術決策 4」的驗證結果）。

## 開放設計問題（定稿時必須為空）
無
