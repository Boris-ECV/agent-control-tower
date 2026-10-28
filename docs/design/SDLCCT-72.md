# 設計文件 — SDLCCT-72 版本成本時間序列圖表的日期軸應固定顯示完整 7 天

## 對應需求規格

對應 G1 已核准的需求規格「版本成本時間序列圖表與表格固定顯示完整 7
天，缺資料的日期明確顯示為『無資料』而不是整欄消失」。5 個 Gherkin
情境（已定稿，逐字抄錄於票上，不重複貼於此）：

1. 日期軸永遠涵蓋完整 7 天（`anchor_date - 6` 到 `anchor_date`），表格
   剛好 7 個 `th`，折線 X 軸資料點數量同樣以這 7 天為準。
2. 某一天某個 version 完全沒有回傳資料點（日期整個缺席，不是
   `value: null`）→ 顯示「—」、折線在該日斷開，不是 0。
3. 既有「point 存在但 `value` 為 `null`」斷線行為維持不變（回歸）——
   且與情境 2「日期缺席」在畫面呈現上必須一致。
4. 所有 version 當週完全沒有任何資料點（`points: []`）→ 仍顯示 7 個
   日期欄位，每格「—」，不拋例外、不拿掉日期軸。
5. `entries` 本身為空陣列（無任何 version）→ 仍顯示 7 個日期欄位，不
   渲染任何資料列，不拋例外。

**修正方向（已定案，照此實作）**：方案 (a)。日期軸改由 `anchor_date`
回推固定 7 天陣列，取代現行 `unionSortedDates()`「只收集至少一個
version 有值的日期」的邏輯。純前端修正，不修改任何後端查詢邏輯。

**範圍外**（spec 已標明）：不修改後端查詢邏輯或新增交叉驗證；不處理
Agent 清單頁小圖本身的同類風險；不改變兩組數字是否應相等的產品定位；
不修改 Y 軸金額標示邏輯（SDLCCT-73）；不改變既有「point 存在但
`value: null`」斷線/「—」渲染慣例。

**依賴**：`bff/api/agent_detail.py` 回應既有的 `anchor_date` 欄位
（SDLCCT-47 已實作，本票不新增後端欄位，不修改 `bff/api/agent_detail.py`
/`bff/api/agents.py`/`bff/opik_metrics.py`）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一
  要改動的檔案）：
  - `unionSortedDates(entries)`（第 17-25 行）：收集所有 `entry.points[].date`
    進一個 `Set`，排序後回傳——這正是 bug 根源：某天若所有 version 都
    沒有該日期的 point，這天就不會出現在回傳陣列裡，日期軸因此縮短，
    而不是顯示「無資料」。
  - `VersionCostChartProps` 目前只有一個欄位：`entries:
    VersionCostSeriesEntry[]`（第 27-31 行，是個 inline object type，
    沒有獨立命名的 interface/type alias）。
  - `dates`（第 32 行）是 `unionSortedDates(entries)` 的結果，下游三
    處消費：
    1. `toXY(dateIndex, value)`（第 49-56 行）用 `dates.length` 算 X
       座標間距；
    2. `byDate(entry)`（第 70-73 行）用 `dates.map((date) =>
       map.get(date) ?? null)` 把每個 version 的 `points` 轉成「每個
       固定日期對應一個 value 或 null」的陣列——**這個函式已經把
       「日期缺席」(`map.get(date)` 回傳 `undefined`) 與「point 存在但
       `value: null`」(`map.get(date)` 回傳 `null`) 兩種情況都正規化
       成 `null`**（`undefined ?? null` → `null`；`null ?? null` →
       `null`），下游（表格 `formatCurrency(value)`、折線
       `value === null` 斷點判斷）完全不分辨這兩種來源，渲染結果天生
       一致——這正是情境 2/3 要求「兩者畫面呈現一致」的既有保證，本票
       不需要新增任何程式碼去讓這兩種情況看起來一樣，只需要讓
       `dates` 本身固定為 7 天，`byDate` 不必改動。
    3. 表格 `<th>`/`<td>` 直接 `dates.map(...)`（第 150-154、163-167
       行）。
  - `entries.map(...)` 渲染折線/圖例/表格列（第 85、133、158 行）在
    `entries = []` 時自然渲染 0 筆，不會拋例外——情境 5 「entries 空
    陣列仍顯示 7 個日期欄位」在本票的改法下會自動成立（`<thead>` 的
    `dates.map` 與 `entries.map(...)` 是兩個獨立迴圈，不互相依賴）。
  - `allValues`/`min`/`max`/Y 軸標示邏輯（SDLCCT-73 新增，第 34-68
    行）完全不依賴 `dates`，本票不觸碰。
- `frontend/components/agent-detail/agent-detail-content.tsx`：
  `<VersionCostChart entries={state.data.version_cost_series} />`
  （第 79 行）是唯一呼叫點。`state.data` 型別來自
  `fetchAgentCostBreakdown`，其回應型別
  `components["schemas"]["AgentCostBreakdownResponse"]`（見
  `frontend/lib/generated/bff-types.ts` 第 130-136 行）已包含
  `anchor_date: string`——**不需要新增/修改任何型別或 API 回應欄位**,
  只是這個既有欄位目前沒有被傳給 `VersionCostChart`（本頁第 44 行已經
  在用 `state.data.anchor_date` 顯示頁首日期，證實此欄位在這個元件
  render 範圍內本來就可取用）。
- `frontend/lib/format.ts::formatTaiwanDate`（第 39-47 行）的既有慣例：
  bff 回傳的日期字串皆為 `YYYY-MM-DD`（UTC midnight 慣例），前端用
  `` `${isoDate}T00:00:00Z` `` 建構 `Date` 物件做顯示轉換，不在這一步
  做時區換算。本票新增的日期回推函式採同一寄生慣例（見決策 1）。
- `bff/api/agent_detail.py` 第 71-82 行：`trend_start = anchor_date -
  timedelta(days=6)`，查詢區間正是 `[anchor_date-6, anchor_date]` 共 7
  天——證實 spec 所述「與 Agent 清單頁 7 天趨勢小圖涵蓋同一組日期」的
  回推規則（`anchor_date - 6` 到 `anchor_date`）與後端現有查詢窗口定義
  一致，前端固定 7 天陣列的回推規則必須照抄這個 `anchor_date - 6`
  起點，不可自創其他起點。
- `frontend/e2e/agent-detail.spec.ts`：既有測試資料（例如第 15-33
  行）目前只給 3 個日期的 points（`2026-10-14`~`16`），`anchor_date`
  卻是 `2026-10-20`——本票修正後，這些既有測試的表格會從目前（因
  bug）顯示的 3 欄變成正確的 7 欄（`2026-10-14` 到 `2026-10-20`），且
  第 63 行 `getByText("—").first()` 的斷言在修正後依然成立（缺席的 4
  天每個 version 每格都會是「—」，斷言不會變假，只是「—」的出現原因
  從「existing null point」變成「兩者都有」）。**這屬於既有測試需要
  開發者依新行為更新斷言的開發期工作，不是設計範圍的開放問題**——
  Gherkin 情境本身已把新行為定稿到逐字可測的程度，不需要本文件額外
  決策。
- 全 repo `Grep("toEqual|getComputedStyle|一致")`（沿用 SDLCCT-73 設計
  文件已做過的同一次查核，本票未新增/變更任何 CSS 類別或選擇器，結論
  不變）：沒有任何測試比較 `VersionCostChart` 或其子選擇器
  （`polyline`/`text`/`th`/`td`/`ul li`）與其他元件的 computed style
  相等。本票只變更「`dates` 陣列怎麼算出來」這個純邏輯層，不涉及任何
  樣式/class 變更，跨元素樣式耦合測試檢查不適用。

## 介面/API 契約

無變更。本票不新增/修改任何 bff 端點，`AgentCostBreakdownResponse`
（含其中的 `anchor_date: string`、`version_cost_series`）型別維持
SDLCCT-47 既有定義不變。

本票唯一的「契約」變更是前端元件 props，非對外 API：

```ts
// frontend/components/agent-detail/version-cost-chart.tsx
export function VersionCostChart({
  entries,
  anchorDate,
}: {
  entries: VersionCostSeriesEntry[];
  anchorDate: string; // "YYYY-MM-DD"，與 AgentCostBreakdownResponse.anchor_date 同格式/同時區慣例（UTC midnight 日期字串）
}) { ... }
```

呼叫端改動：

```tsx
// frontend/components/agent-detail/agent-detail-content.tsx 第 79 行
<VersionCostChart
  entries={state.data.version_cost_series}
  anchorDate={state.data.anchor_date}
/>
```

## 資料模型

無新增資料模型。純前端 prop 新增 + 元件內部日期陣列推導邏輯的替換，
不涉及任何資料表/欄位/索引變更。

## 關鍵技術決策

### 1. 刪除 `unionSortedDates`，新增 `fixedSevenDates(anchorDate)`，以 UTC midnight 日期運算回推 7 天

```ts
function fixedSevenDates(anchorDate: string): string[] {
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}
```

`dates = fixedSevenDates(anchorDate)` 取代原本 `dates =
unionSortedDates(entries)`（第 32 行），`unionSortedDates` 整個函式
直接刪除（spec 明確說「取代現行邏輯」，不是新增一個平行邏輯，保留
死碼只會讓未來讀者誤以為兩套邏輯都在用）。

用 `Date` 物件的 `setUTCDate`/`toISOString()` 做日期運算，而不是對
`YYYY-MM-DD` 字串直接做字串切割/數字相減，是因為後者在跨月/跨年邊界
會算錯（例如 `anchor_date = "2026-11-02"`，`-6` 天要回推到
`"2026-10-27"`，純字串減法處理不了「月份借位」）。`T00:00:00Z` 的建構
方式與 `formatTaiwanDate`（`frontend/lib/format.ts` 第 40 行）既有慣例
完全相同——全部以 UTC midnight 解讀 bff 回傳的日期字串，不在這一步
混入任何時區換算，兩個函式對同一個輸入字串的「這是哪一天」判斷永遠
一致。

### 2. `byDate()` 不需要修改——「日期缺席」與「value: null」已天然收斂成同一個 `null`

既有 `byDate(entry)`（第 70-73 行）用 `map.get(date) ?? null`：`Map`
查不到 key（日期缺席）回傳 `undefined`，`?? null` 轉成 `null`；
`value` 本身是 `null` 也還是 `null`。兩種輸入在這一步就已經收斂成
同一個輸出，下游 `formatCurrency(null)` → 「—」、折線
`value === null` 判斷斷點完全不分支來源。情境 2/3「兩者畫面呈現一致」
不需要新增程式碼來保證，只需要確認（已在「現狀查核」確認）既有
`??` 運算子的行為正是如此——這是本票刻意選擇「不碰 `byDate`」而只換
`dates` 來源的理由，改動面最小、也不會意外破壞既有行為。

### 3. `dates` 永遠是長度 7 的陣列，不因 `entries`/`points` 內容而變動——情境 4/5 不需要額外的空陣列特判

`fixedSevenDates` 只吃 `anchorDate` 一個參數，完全不看
`entries`/`points`。情境 4（所有 version 的 `points` 皆為空陣列）與
情境 5（`entries` 本身為空陣列）下，`dates` 依然是同樣的 7 天——
`<thead>` 的 `dates.map(...)`（第 150-154 行）不受影響；`<tbody>` 的
`entries.map(...)`（第 158 行）在 `entries = []` 時天然渲染 0 筆
`<tr>`，在 `points = []` 時 `byDate` 的 `Map` 是空的，每一格查不到任何
日期都回傳 `null` → 全部顯示「—」。兩種情境都不需要新增 if 分支或
空陣列特判，是 `dates`/`entries` 兩個迴圈互相獨立這個既有結構的直接
結果，不是本票新增的保護邏輯。

## UI 原型

`docs/design/SDLCCT-72-prototype.html`（可直接在瀏覽器開啟的靜態
HTML）。對照呈現「修正前（bug）」與「修正後」兩個版本的表格 + 折線：

- 修正前：`anchor_date = 2026-10-20`，某個 version 缺 `2026-10-18`
  這天的資料點（整個日期缺席）——表格只剩 6 欄（10/14~10/17、
  10/19~10/20），日期軸明顯被壓縮，10/18 整欄消失，容易誤讀成「資料
  窗縮短了」。
- 修正後：同一組資料，表格固定顯示 7 欄（10/14 到 10/20），缺資料的
  10/18 那一格明確顯示「—」，折線在該日的 X 位置斷開，日期軸長度/
  間距不受影響。
- 兩個版本並排，並以文字註記對應 Gherkin 情境 1/2，方便人類在 G1b
  審核時一眼比對差異。

本票是對既有圖表資料來源邏輯的修正，不新增頁面/版面配置，不重複
`docs/design/SDLCCT-48-prototype.html` 已涵蓋的整頁版面，比例上符合
CONSTITUTION「設計文件應與故事規模成比例」。

## 開放設計問題（定稿時必須為空）

（無）
