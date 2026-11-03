# 設計文件 — SDLCCT-114 執行詳情頁：標題簡化與 Trace ID 複製按鈕

## 對應需求規格
G1 核准版本（見 ticket SDLCCT-114 描述與 3 條 Gherkin AC，拆分自
SDLCCT-87，依 `ui review/design-changes-v2-.md` 第二章第 5 節）：
1. 標題只顯示「執行詳情」，不含 Trace ID 字串（Scenario「標題簡化顯示」）。
2. Trace ID 顯示在標題下一行，使用等寬字型樣式（Scenario「Trace ID 以
   等寬字顯示在標題下一行」）。
3. 點擊複製按鈕將 Trace ID 寫入剪貼簿，並顯示「已複製」提示文字，約 2
   秒後恢復（Scenario「點擊複製按鈕複製 Trace ID」）。

讀取現狀確認：`frontend/components/trace-detail/trace-detail-content.tsx`
第 43-45 行目前寫法：

```tsx
<h1 className="mb-6 text-left text-2xl leading-8 font-bold text-text-primary">
  {t("traceDetail.header.title")} — {traceId}
</h1>
```

`t("traceDetail.header.title")`（`frontend/lib/i18n/messages.ts` 第 192
行）已經是「執行詳情」——本票不改標題文字本身，只拆行＋加複製按鈕，與
ticket「背景」段落所述一致。58 行的 `ErrorCard` 也傳入同一個
`t("traceDetail.header.title")` 作為卡片標題，與本頁 `<h1>` 文字來源相同
但是完全獨立的 prop，不在本票改動範圍內（error 分支不顯示 Trace ID 列，
維持現狀）。

依賴 SDLCCT-56（已 Done，提供 `TraceDetailContent` 基礎結構）、SDLCCT-82
（已 Done，共用樣式規則，本票套用其 `font-mono` 等寬字慣例，見決策 2）。

範圍外：不含標籤列／摘要列／排序／瀑布圖變更（其他拆分子單）；不改動
`TraceBreadcrumbs`／`TraceBackLink` 既有元件與其版面位置（兩者皆在
`<header>` 內，本票只動 `<main>` 內的 `<h1>` 區塊）；不處理 SDLCCT-115／
118 改動的其他元件。

## 介面/API 契約
無新增/變更端點。本票純前端渲染與瀏覽器 Clipboard API（`navigator
.clipboard.writeText`）操作，不涉及後端或 bff 契約變更。

## 資料模型
無新增資料模型。`traceId` 已由現有 `useParams<{ key: string; traceId:
string }>()` 提供（SDLCCT-56 既有結構），本票不新增欄位。

## 關鍵技術決策

1. **拆成兩個獨立元素：`<h1>` 只放標題文字，下方新增一個
   `<div className="mt-1 flex items-center gap-2">` 放 Trace ID（等寬字）
   ＋複製按鈕，兩者皆維持在現有 `<main>` 區塊內、`<h1>` 原本的位置
   （`state` 分支渲染之前），不搬動 `TraceBreadcrumbs`／`TraceBackLink`
   （兩者在 `<header>`，本票完全不碰）。**
   理由：AC 明確要求「標題只顯示『執行詳情』」與「Trace ID 顯示在標題
   下一行」，兩者是需要視覺分離的兩個區塊，用一個新的 sibling
   `<div>` 而非繼續擠在 `<h1>` 內最直接對應 AC 文字。`ErrorCard` 分支
   （58-64 行）不受影響：它只需要標題字串，不需要 Trace ID 列，本票不
   改動該分支傳入的 `title` prop。

2. **Trace ID 文字用 Tailwind `font-mono` utility class**，不新增自訂
   CSS class 或字型變數。
   理由：`docs/design-system.md` 本身是 skeleton、未定義專屬的等寬字
   token；`font-mono` 是 Tailwind 內建 utility，專案既有程式碼已在多處
   使用同一慣例顯示「代碼感」文字（如 `anomaly-table.tsx`、
   `status-badge.tsx` 顯示 id/code 類字串），依 CONSTITUTION「Code
   style — 遵循既有慣例優先於個人偏好」，沿用而非新發明樣式。顏色沿用
   `text-text-secondary`（次要文字色，與現有 `traceDetail.footer
   .dataSource` 等輔助性文字一致），字級 `text-sm`。

3. **自行實作一個本頁內的 `TraceIdCopy` 元件
   （`components/trace-detail/trace-id-copy.tsx`），不等待或依賴
   SDLCCT-110。**
   搜尋 `navigator.clipboard` 與 `已複製`／`copied`／`clipboard` 關鍵字於
   `frontend/` 全專案，確認目前沒有任何既有複製按鈕元件或共用
   clipboard 工具可重用。SDLCCT-110（同樣在 Trace ID 相關頁面加複製功能
   的平行拆分子單）尚未有對應的 `docs/design/SDLCCT-110.md` 或程式碼落
   地，故本票不能依賴其輸出，也不應為了等待它而延後本票。依
   CONSTITUTION「Scope discipline — 實作只做規格要求的事」，本票交付一
   個自足、不依賴其他尚未完成子單的實作。
   **未來重構機會（非本票範圍，僅記錄）**：若 SDLCCT-110 也落地一個結構
   相同的複製按鈕，之後可考慮抽成共用 `CopyButton` 元件消除重複——這是
   留給未來 story 的機會，本票不預先設計它。

4. **複製成功提示的 2 秒還原機制：元件內部 `useState<boolean>`
   （`copied`）＋ `useRef<ReturnType<typeof setTimeout> | null>`
   記錄 timer，`useEffect` cleanup 在 unmount 時 `clearTimeout`。**
   點擊處理流程：
   ```tsx
   const [copied, setCopied] = useState(false);
   const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

   useEffect(() => {
     return () => {
       if (timerRef.current) clearTimeout(timerRef.current);
     };
   }, []);

   const handleCopy = useCallback(async () => {
     try {
       await navigator.clipboard.writeText(traceId);
       setCopied(true);
       if (timerRef.current) clearTimeout(timerRef.current);
       timerRef.current = setTimeout(() => setCopied(false), 2000);
     } catch {
       // Clipboard API 可能因權限或非 HTTPS context 被拒絕；AC 未定義
       // 失敗時的畫面行為，故不顯示「已複製」、不丟例外中斷畫面渲染，
       // 僅靜默失敗（與 CONSTITUTION「Failure handling」對後端呼叫要求
       // 顯式錯誤的精神不同——這裡是使用者本機瀏覽器權限問題，不是資料
       // 正確性問題，沒有「看起來像沒複製但其實複製了」的歧義風險）。
     }
   }, [traceId]);
   ```
   理由：每次點擊都先清掉舊的 timer 再設新的，避免連續點擊時「已複製」
   提示被前一次的 timeout 提早收掉；unmount 時清理避免 React
   「Cannot update unmounted component」warning。計時用
   `setTimeout`/`useState`，不用第三方函式庫——沿用 CONSTITUTION「Prefer
   three similar lines over premature abstraction」，一個單純計時器不需
   要引入套件。
   按鈕本身维持原生 `<button type="button">`，非複製狀態文案為
   新增 i18n key `traceDetail.header.copyButton`（「複製」），複製成功
   後暫時以 `traceDetail.header.copied`（「已複製」）取代按鈕文字本身
   （而非另外彈出 toast/tooltip）——AC 原文「畫面出現『已複製』提示文字」
   沒有指定提示的呈現位置，本票選擇最簡單、不需要額外 toast
   機制或定位邏輯的做法：直接覆蓋按鈕文字。按鈕需有
   `aria-label`（新增 `traceDetail.header.copyAriaLabel`「複製 Trace
   ID」）確保可及性，不只靠圖示或文字變化傳達功能。

5. **複製按鈕放在 Trace ID 文字右側、同一行（`flex items-center
   gap-2`），兩者皆在標題下一行、縮排與 `<h1>` 左緣對齊。**
   理由：AC 要求「Trace ID 旁的複製按鈕」，與 Trace ID 同一行最直接對應
   這句話；對齊 `<h1>` 左緣維持視覺上標題/副標資訊的垂直對齊慣例（本頁
   `<main>` 既有 `footer`／內容區塊皆靠左對齊，見 76 行
   `text-left`）。

## 跨元件樣式耦合檢查
已於 `frontend/e2e/` 與 `frontend/components/trace-detail/*.test.tsx`
搜尋 `toEqual`／`getComputedStyle`／「一致」等跨元素樣式相等性斷言：
現有唯一一處 `getComputedStyle` 比較（`trace-detail.spec.ts` Scenario 2，
比較父子 span row 的 `paddingLeft` 縮排大小關係）與本票改動的
`<h1>`／新 Trace ID 列／複製按鈕完全無關（比較對象是 `SpanTreeRow`
縮排，不是標題區塊），無需求回歸的串連測試。本票新增的視覺元素
（標題、Trace ID 列、複製按鈕）目前沒有任何其他元件被要求與它們
樣式一致，故無開放問題。

## UI 原型
見 `docs/design/SDLCCT-114-prototype.html`（可直接在瀏覽器開啟）。展示：
- 狀態 A：初始畫面——標題「執行詳情」單獨一行，下一行等寬字顯示
  `trc_a1b2c3d4e5f6` ＋「複製」按鈕。
- 狀態 B：點擊複製按鈕後——按鈕文字暫時變成「已複製」（示意 2 秒後恢復
  為「複製」，原型為靜態示意不含真正的計時器行為）。

## 開放設計問題(定稿時必須為空)
無。
