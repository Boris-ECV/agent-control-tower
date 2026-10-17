# 設計文件 — SDLCCT-32 Cost overview screen（Portal MVP，畫面 1/6）

## 對應需求規格
對應 G1 已核准的需求規格「Cost overview screen」。使用者故事：工廠主管打開
Portal 第一眼看到本月成本 vs 預算總覽、預估月底超支金額、以及跨 Agent 期間
比較誰漲最多。7 條 Gherkin AC：(1) 總覽數字可追溯、來自 registry 預算加總 +
全部 9 個 Agent 的 Opik COST 查詢；(2) 未登錄 Agent 花費計入分子不計入分母，
並明顯標示治理缺口；(3) 跨 Agent 期間比較依成長排序、顯示 registry display
名稱；(4)「今天」依 `bff/anchor.py::get_anchor_date()` 換算台灣時間顯示；
(5) 查詢失敗明確顯示錯誤、單一查詢失敗不白屏；(6) zh-TW、無 Opik 品牌字樣、
套用已定稿的 `docs/design-system.md`；(7) G1b 原型可獨立開啟
（Next.js + shadcn/ui + Tailwind）。範圍外：其他 5 個畫面、寫入流程、登入/
權限/多租戶、SDLCCT-18/20、客戶品牌/Logo、bff 對外 HTTP 路由的通用架構設計
（本票只決定本畫面所需的具體路由，不設計通用框架）。依賴：SDLCCT-33（Done,
`docs/design-system.md` 已定稿）、SDLCCT-9/10/11/12/15（Done）。

## 介面/API 契約

本票新增 bff 的第一個對外 HTTP 介面。**選用框架：FastAPI**（`project-
profile.yaml` 已預告「FastAPI anticipated for the first story that adds
an actual HTTP endpoint」）——理由：bff 既有函式庫（`opik_metrics.py` 等）
已大量使用 Python dataclass/型別標註，FastAPI 的 Pydantic 回應模型可直接
包一層薄的 serialization，不需要額外手刻 JSON schema 驗證；且是 Python
生態中與 Next.js 前端整合最常見、文件最成熟的選擇，降低後續 5 個畫面重複
決定框架的成本。新增依賴：`bff/pyproject.toml` 加入
`fastapi>=0.115`、`uvicorn[standard]>=0.30`（dev 用 `httpx` 既有，供
`TestClient` 測試）。`project-profile.yaml` 的 `commands.bff_run` 新增
`cd bff && uv run uvicorn api.app:app --reload --port 8000`（由 developer
階段落實，本文件只定決策，不改 project-profile.yaml 本身）。

**新增模組位置**：`bff/api/app.py`（FastAPI app 實例、CORS 設定、路由註冊）、
`bff/api/cost_overview.py`（本畫面的業務邏輯：組合 registry + Opik 查詢、
計算衍生數字），沿用 `anomaly_governance_gap.py` 既有的
`sys.path.insert(..., "seed")` 手法 import `registry.get_agent`/
`registry.load_registry`（不重新發明一套 import 機制）。

**路由設計：兩個獨立端點，不是一個端點回傳整頁 JSON**——理由見下方「關鍵
技術決策」錯誤隔離段。

### `GET /api/cost-overview/summary`

無 query 參數（時間窗完全由 `anchor.get_anchor_date()` 決定，不開放前端
指定日期——本故事範圍內只有「本月」一種視角）。

成功回應 `200`：
```json
{
  "anchor_date": "2026-10-15",
  "month_start": "2026-10-01",
  "days_elapsed": 15,
  "days_in_month": 31,
  "total_spend": 12345.67,
  "total_budget": 9000.0,
  "budget_consumed_pct": 137.17,
  "projected_month_end_spend": 25507.0,
  "projected_overspend": 16507.0,
  "unregistered": {
    "spend": 234.5,
    "agents": [
      {"key": "temp_supplier_scraper", "display": "臨時供應商爬蟲", "spend": 234.5}
    ]
  }
}
```
- `total_spend`：全部 9 個 Agent（`registry.load_registry()` 的全部
  `key`）透過 `opik_metrics.get_project_metrics_cached(..., MetricType.COST,
  interval=Interval.TOTAL, interval_start=month_start, interval_end=
  anchor_date+1day)` 查詢後加總（分子，含未登錄 Agent）。
- `total_budget`：`registry.load_registry()` 中 `registered is True`
  （等同 `budget is not None`，見 SDLCCT-31 的判定方式）的 Agent 的
  `budget` 加總（分母，不含未登錄 Agent）。
- `budget_consumed_pct`：`total_spend / total_budget * 100`；
  `total_budget == 0` 時回傳 `null`（不得回傳 0 或除以零錯誤──依
  CONSTITUTION「缺值顯示 unknown，不可顯示 0」，前端顯示「—」並標註原因）。
- `projected_month_end_spend`：線性外推公式
  `total_spend / days_elapsed * days_in_month`（`days_elapsed` =
  `anchor_date` 在當月的日序數，例如 10/15 → 15；`days_in_month` 用
  `calendar.monthrange()`）。`days_elapsed == 0` 無法外推時回傳 `null`
  （理論上不會發生，因為 anchor 必落在月內某一天，但程式仍需防呆）。
- `projected_overspend` = `projected_month_end_spend - total_budget`
  （可為負值，代表預估月底仍在預算內；前端只在 >0 時以警示色呈現）。
- `unregistered`：`registered is False` 的 Agent 清單與各自花費，供前端
  渲染「治理缺口」標示（對應 AC2）。

### `GET /api/cost-overview/period-comparison`

成功回應 `200`：
```json
{
  "anchor_date": "2026-10-15",
  "current_period": {"start": "2026-10-01", "end": "2026-10-15"},
  "previous_period": {"start": "2026-09-01", "end": "2026-09-15"},
  "agents": [
    {
      "key": "predictive_maintenance",
      "display": "設備預測性維護",
      "current_cost": 3200.0,
      "previous_cost": 1800.0,
      "delta": 1400.0,
      "delta_pct": 77.78
    }
  ]
}
```
- `agents` 涵蓋全部 9 個 Agent（不排除未登錄 Agent——AC3 沒有排除它，只
  要求「顯示 registry 的 display 名稱」，未登錄 Agent 的 display 仍存在，
  見 SDLCCT-12 的 `temp_supplier_scraper` 範例，dept 為「未登錄」但
  display 仍是「臨時供應商爬蟲」)，依 `delta`（本期 - 前期，絕對金額）
  **降冪排序**——「誰漲最多」在成本儀表板情境以金額衝擊為主要排序依據，
  `delta_pct` 一併回傳供前端顯示百分比但不作為排序鍵（避免小額 Agent 因
  百分比爆炸排到最前面，與「主管優先關注哪個 Agent」的使用情境不符）。
- **前期定義（本票決定，spec 未明確指定公式）**：與本期同長度、往前推一
  個月的對應區間（本期 10/1–10/15 → 前期 9/1–9/15），即月對月
  （month-over-month）比較，而非「本月前半 vs 本月前半之前 N 天」。理由：
  「跨 Agent 期間比較」在成本監控情境最常見的語意就是 MoM，且 anchor 日期
  本身即代表「目前在這個月的第幾天」，用上個月同樣天數範圍比較最能回答
  「這個 Agent 這個月到現在的花費速度，比上個月同期快多少」。
- `previous_cost`/`current_cost` 皆用 `Interval.TOTAL` 單次查詢（不逐日），
  與 summary 端點的做法一致。
- 查詢缺失天數/月份邊界（例如 anchor 落在月初第 1 天，前期會回溯到上上個
  月 1 天）：以 Python `dateutil` 風格手算月份偏移（不是用 timedelta(30)
  這種近似值），避免 28/30/31 天月份造成天數窗口漂移。

**失敗時的回應**：任一端點內部呼叫 Opik 失敗（`OpikHTTPError` /
`OpikTimeoutError` / `OpikResponseFormatError` / `OpikConfigError`）時，
回傳 `502 Bad Gateway`：
```json
{"error": {"message": "...", "endpoint": "/v1/private/...", "status_code": 503}}
```
`message` 直接取自例外的字串表示（已包含 endpoint/status，見
`opik_metrics.OpikClientError.__init__`），不重新包裝成模糊訊息——對應
CONSTITUTION「失敗必須明確顯示 endpoint 與 status，不可呈現空白或 0」。
`MissingProjectIdsError`（理論上不會發生，因為 registry 固定 9 筆）歸類為
`500 Internal Server Error`，代表程式邏輯錯誤而非外部依賴失敗。

## 資料模型
無新增持久化資料模型。本票讀取既有的 `seed/registry.py`（SDLCCT-12，已
定稿）與既有的 Opik 查詢函式（`bff/opik_metrics.py`，SDLCCT-10/11），不
新增資料表/欄位/索引。`bff/api/` 內的 Pydantic response model 是序列化層，
不是持久化資料模型。

## 關鍵技術決策

- **兩個獨立端點而非單一整頁端點**——對應 AC5「單一查詢失敗不得讓整頁
  白屏」。若用單一端點在伺服器端 catch 每個子查詢的例外再拼成一包含
  `errors` 陣列的 200 回應，前端仍需要為「這包 JSON 裡某個欄位是 null
  因為後端吞了例外」設計特殊渲染邏輯，且伺服器端「吞例外繼續跑」與
  CONSTITUTION「失敗必須明確顯示錯誤」的精神（錯誤不該被吞掉變成一個
  可忽略的欄位）有摩擦。拆成兩個端點後，每個端點各自是「完全成功
  200」或「明確失敗 502/500」的二元狀態，前端用兩次獨立 fetch、各自包一
  個 error boundary 元件，一個失敗時另一個卡片的 fetch 完全不受影響——
  錯誤隔離發生在 HTTP 請求層級，不需要額外的「部分失敗」協定。
- **projected_overspend 用線性外推（當期花費速度 × 當月剩餘天數比例）**
  而非更複雜的趨勢模型（例如加權近期几天、季節性調整）——spec 只說「預估
  月底超支金額」，沒有指定演算法；線性外推是此類儀表板最常見、最容易讓
  使用者心算驗證（「花費速度不變的話」）的基準方法，且避免引入需要額外
  驗證的統計假設，符合 CONSTITUTION「規格模糊時不要過度設計」與
  「scope discipline」。
- **期間比較用月對月（MoM），不是「本月至今 vs 上個 N 天」**——見上方
  API 契約段落，已附理由；因為這是規格留給本票解決的技術細節性詮釋（不是
  產品範圍決策——不影響任何使用者可見的範圍邊界，只是「比較基準怎麼算」），
  依任務指示在此直接定案並揭露理由，不列為開放問題。
- **未登錄 Agent 仍計入 `total_spend` 分子、分母用 `registered` 欄位過濾**
  ——逐字對應 AC2，`registered` 欄位（非 `budget is not None`）作為權威
  判定依據，與 `bff/anomaly_governance_gap.py` 現有判定邏輯（三者 OR）不同
  ──此處只用 `registered`，因為 AC2 原文只講「未登錄 Agent」，不是治理
  缺口的完整定義（治理缺口的完整定義是 SDLCCT-31 的範疇，本票不重複其
  邏輯，避免兩處定義分裂維護；若未來某個已登錄但 owner/budget 缺失的
  Agent 出現，分母計算仍用 `registered`，因為目前 catalog 中
  `registered=False` 與 `budget is None` 完全等價，沒有第三種情境需要
  處理，等到真的出現分裂情境再回頭決定）。
- **查詢範圍固定為全部 9 個 Agent，不開放前端篩選**——AC1 明文「對全部 9
  個 Agent 查詢」，本故事沒有任何篩選 UI 的 AC，不預先加篩選參數。
- **FastAPI 作為 bff 的 HTTP 框架**——見上方 API 契約段落理由；此決策影響
  後續所有畫面的 bff HTTP 層，但本票只負責「啟用」這個選擇並實作本畫面
  所需的兩個端點，不設計通用的路由/版本/中介層架構（明文範圍外）。
- **Next.js 專案骨架目前不存在，建立骨架屬於本票開發階段範圍**——`frontend/`
  目錄尚未建立（`project-profile.yaml` stack 僅宣告 Python），但本故事的
  AC7 要求「G1b 原型可獨立開啟（Next.js + shadcn/ui + Tailwind 技術棧）」
  且本故事整體目標是「串接真實資料」的第一個使用者可見畫面，不可能在沒有
  Next.js 專案的情況下完成，因此建立骨架是本票開發階段（非 G1b 原型階段）
  的必要工作，不是未來故事的範圍——G1b 原型本身用純 HTML/CSS（見下方
  「UI 原型」段）即可滿足「可獨立開啟、套用 design-system token」的審核
  需求，不需要先有 Next.js 專案才能產出原型。
  開發階段的建置指令：
  ```
  npx create-next-app@latest frontend --typescript --tailwind --app \
    --src-dir=false --import-alias "@/*"
  cd frontend && npx shadcn@latest init
  ```
  之後把 `docs/design-system.md` 第 9 節的 `globals.css`/
  `tailwind.config.ts` token 對應原文搬入新專案（已在 SDLCCT-33 定案，本票
  不重新決定）。`project-profile.yaml` 的 `stack.frameworks`/
  `commands.e2e`/`structure` 由 developer 階段更新，記錄實際採用的 Next.js
  版本與測試工具。
- **per-card 錯誤呈現：每張卡片/區塊各自一個 fetch + 一個 error boundary**
  ——「本月成本 vs 預算」卡片群組對應 `summary` 端點、「期間比較排行」
  區塊對應 `period-comparison` 端點，各自用獨立的 `try/catch`（或
  React 的 per-section error boundary，視 developer 階段選用的資料請求
  方式，例如 SWR/TanStack Query 的 per-query `isError` 狀態）渲染錯誤卡片
  （顯示：「查詢失敗：<endpoint> 回應 <status>，請稍後重試」），不讓一個
  區塊的例外往上拋到整個頁面層級的 error boundary——對應 AC5「單一查詢
  失敗不得讓整頁白屏」。錨點日期（AC4 的「今天」顯示）直接讀
  `summary` 回應的 `anchor_date` 欄位換算台灣時間顯示；若 `summary` 端點
  本身失敗，錨點日期顯示區塊也跟著顯示「無法取得」而非留白或假造日期。
- **台灣時間換算在前端/展示層，不在 bff**——bff 回傳的 `anchor_date`/
  `month_start`/區間欄位全部是 UTC 日期字串（沿用 `anchor.py` 既有慣例：
  `get_anchor_date()` 回傳 UTC-aware datetime），UTC+8 的實際顯示轉換在
  Next.js 前端用 `Intl.DateTimeFormat` 或等效函式處理，對應 CONSTITUTION
  「Daily buckets and today are UTC; convert to a display time zone only
  at the presentation layer」。

## UI 原型
`docs/design/SDLCCT-32-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，
內嵌 `<style>`，套用 `docs/design-system.md` 定稿的實際色彩/字級/間距/
元件 token，佔位數字清楚標示為範例資料，非真實查詢結果）。涵蓋：
- 本月成本 vs 預算總覽卡片群組（總花費、總預算、消耗百分比、預估月底
  超支金額）。
- 「未登錄 Agent 治理缺口」標示（徽章 + 清單項）。
- 跨 Agent 期間比較排行清單（依漲幅排序，顯示 display 名稱）。
- 「今天」錨點日期顯示（台灣時間格式）。
- 一個區塊的錯誤狀態範例（期間比較卡片示範查詢失敗時的呈現，不白屏，
  其餘卡片正常顯示）。

本 repo 目前沒有任何既有前端頁面/`.tsx`/`.jsx` 檔案、也沒有 `tests/e2e/`
目錄（與 SDLCCT-33 設計文件查核結果一致），因此不存在任何比較兩個元素
computed style 相等的既有測試，本票的跨元素樣式耦合測試檢查不適用。

## 開放設計問題（定稿時必須為空）
（無）
