# 設計文件 — SDLCCT-76 版本成本圖表補上未標記 deployed_version 的成本（「其他」entry）

## 對應需求規格

對應 G1 已核准的需求規格「版本成本圖表依版本拆分時遺漏未標記
deployed_version 的成本，總和與 Agent 清單頁總成本仍對不上」。範圍：
`bff/api/agent_detail.py::get_agent_cost_breakdown()` 的 `version_cost_series`
在既有版本拆分查詢之外，另外查一次同窗口、不帶 breakdown 的每日總成本，
逐日計算「其他 = 總成本 - Σ(各 version 值，null 視為 0)」，當任一天的
「其他」> 1 cent 門檻時，在回應陣列末端追加一個
`version: "其他／未標記版本"` 的 entry；否則不追加，維持現有回應形狀
（SDLCCT-47 既有測試案例的形狀與行為不受影響）。

範圍外（spec 已標明，本文件不觸碰）：`bff/api/agents.py::_trend_points()`
及 Agent 清單頁查詢邏輯；回溯「其他」成本對應哪些 trace；前端
`version-cost-chart.tsx` 的顏色/樣式呈現（本票不改動任何前端檔案，留給
另一張票一併定案）。

## 介面/API 契約

端點本身不變：仍是既有的

```
GET /api/agents/{key}/cost-breakdown?top_n=<int>
```

（見 `docs/design/SDLCCT-47.md` 完整契約，本文件只描述本票造成的
response body 變化。）

`version_cost_series` 欄位行為變更如下，其餘欄位（`model_cost_breakdown`、
`top_traces`、`key`/`display`/`anchor_date`/`period_start`）完全不變：

```jsonc
{
  // ...既有欄位不變...
  "version_cost_series": [
    { "version": "v2.1", "points": [ { "date": "2026-10-09", "value": 7.0 }, ... ] },
    // ...其餘既有 version entries（順序、形狀與 SDLCCT-47 完全一致）...

    // 新增（條件性）：只有當至少一天的「其他」> 1 cent 門檻時才出現，
    // 永遠排在所有既有 version entries 之後（不插在中間、不排到最前）
    {
      "version": "其他／未標記版本",
      "points": [
        { "date": "2026-10-09", "value": null },   // 當天無缺口 -> null（見決策 #3）
        { "date": "2026-10-12", "value": 3.0 },     // 當天總成本 10.00，版本拆分只有 7.00 -> 缺口 3.00
        ...
      ]
    }
  ]
}
```

Scenario 3（版本拆分查詢回傳空陣列）時，`version_cost_series` 只包含這一個
`"其他／未標記版本"` entry，`points` 覆蓋整個 7 天視窗、每天 value 等於
當天不帶 breakdown 的總成本（null 僅在總成本本身查無資料時出現，見
決策 #3）。

Scenario 2（版本拆分每天都已完整涵蓋總成本，容許誤差內）時，不新增這個
entry，回應形狀與 SDLCCT-47 既有測試案例逐位元組一致。

404 / 502 行為不變（沿用 SDLCCT-47 既有的 `None` 回傳 / 例外傳遞機制）；
新增的第三個查詢（不帶 breakdown 的每日總成本）若失敗（`OpikClientError`/
`OpikConfigError`），與既有兩個查詢同等對待：不攔截、原樣往上傳給
`app.py` 既有的 502 handler（整個請求回傳明確 502，不回傳部分結果 —— 沿用
SDLCCT-47 決策 #3 的「任一查詢失敗即整體 502」原則，新查詢沒有理由享有
不同待遇）。

### 新增查詢（`bff/api/agent_detail.py`，既有檔案，只新增邏輯不更動既有函式簽章）

在既有兩次 `get_project_metrics_cached()` 呼叫之外，新增第三次呼叫：

```python
total_daily_metrics_map = get_project_metrics_cached(
    [key],
    MetricType.COST,
    interval=Interval.DAILY,
    interval_start=_to_utc_midnight(trend_start),
    interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
    # breakdown 省略 -> None：與 bff/api/agents.py::_trend_points() 同一種
    # "不帶 breakdown 的每日總成本" 查詢形狀，同一個 7 天視窗
)
```

新增兩個純函式（同檔案，無外部依賴變化）：

```python
def _by_date(series_tuple: tuple[MetricSeries, ...]) -> dict[str, float | None]:
    """{date_iso: value}，跨多個 series 合併同一天時：若任一 series 在該天
    有非 None 值則加總非 None 值；若該天所有 series 都是 None（或該天完全
    沒有任何 series 有資料),該天輸出 None（沿用既有「不得把未知資料補成
    0」慣例，見決策 #3）。"""

def _compute_other_entry(
    total_by_date: dict[str, float | None],
    version_series: list[dict],  # 已經組好的 version_cost_series（本票之前的既有輸出）
) -> dict | None:
    """回傳 {"version": "其他／未標記版本", "points": [...]}，或 None（不需要
    追加時）。points 的日期集合、順序完全取自 total_by_date 的 key（依
    決策 #4，而不是取自 version_series 的日期——因為 Scenario 3 時
    version_series 可能是空陣列，此時仍必須能产出完整 7 天的 points）。"""
```

呼叫順序：先組出既有的 `version_cost_series`（邏輯不變），再呼叫
`_compute_other_entry(_by_date(total_daily_metrics_map.get(key, ())), version_cost_series)`，
若回傳非 `None` 才 `.append()` 到 `version_cost_series` 陣列末端。

### 既有測試 fixture 需要調整（提醒給開發者，非產品決策）

`bff/tests/test_api_agent_detail.py::_patch_metrics()` 目前用
`interval.value == "DAILY"` 來判斷「這是 version 查詢還是 model 查詢」
——本票新增的第三個查詢同樣是 `DAILY`，單憑 `interval` 已無法分辨三者。
開發階段需要把判斷條件改成同時看 `breakdown`（`None` → 總成本查詢；
`Breakdown(METADATA, ...)` → version 查詢；`Breakdown(TAGS)` → model 查詢），
否則既有測試會把新查詢誤判成 version 查詢（或反之），導致既有
SDLCCT-47 測試全部失敗。這是測試基礎設施的更新，不是本文件要解決的
產品行為，但不先說清楚的話開發者會在不知道根因的情況下卡住。

## 資料模型

無新增資料模型。本票與 SDLCCT-47 一樣是純讀取組合（read-composition）：
新增的第三個查詢是既有 `bff/opik_metrics.py::get_project_metrics_cached()`
的另一次呼叫（`breakdown=None`，該函式已支援、不需要修改
`opik_metrics.py`），沒有新建資料表、欄位、索引，也沒有任何寫入或持久化
狀態。

## 關鍵技術決策

### 1. 新查詢直接重用 `get_project_metrics_cached(breakdown=None)`，不新增共用函式、不重構 `bff/api/agents.py::_trend_points()`

Spec 本身用「可考慮抽共用函式，不強制」的字眼明確把這留給實作者判斷。
`agents.py::_trend_points()` 是對「`metrics_map` 已經回來之後」的格式轉換
（series → `{date, value}` 列表），而本票需要的是「依日期合併、和
version 拆分做減法」，兩者的後處理邏輯形狀不同，硬抽共用函式只會讓
`agents.py`（範圍外，spec 明確禁止修改）被迫跟著改介面。因此只重用查詢
呼叫本身的參數形狀（`interval=DAILY` + 7 天視窗），後處理邏輯留在
`agent_detail.py` 本地，不跨檔案抽象。

### 2. 第三個查詢失敗與既有兩個查詢同等看待（整體 502，不做部分結果容錯）

Spec 沒有特別講這個新查詢失敗時該怎麼辦，但 SDLCCT-47 決策 #3／AC4
已經把「三個底層查詢中任一失敗 → 整體明確 502，不回傳部分結果」訂為
這個端點的通則；本票只是把「三個」變成「四個」查詢，没有理由讓新查詢
例外處理成「查不到就當作沒有缺口」（那會把一次後端故障偷偷呈現成
「資料完全乾淨」的假象，對 FinOps reviewer 是誤導）。因此新查詢同樣
不包在 try/except 裡，例外原樣往上傳。

### 3. 用 `null` 表示「總成本當天本身查無資料」與「缺口在門檻內（視為沒有缺口）」，不用 `0` 填補未知

沿用整個程式庫（`opik_metrics.py` 第 65 行、`agents.py::_trend_points()`
決策 1、SDLCCT-47 決策 #2）一致遵守的「null = 未知，絕不補成 0」慣例。
本票的驗收條件原文允許「value 為 null 或 0」兩者皆可，但既有程式碼對
「未知」一律用 `null`，為了讓這個新 entry 的 null 語意跟同一個回應裡其他
entry（version/model）一致、不讓前端（消費端）需要分別處理兩種「不知道
是 0 還是沒資料」的表達方式，選擇 `null`（AC 本身允許的範圍內做最小且
一致的選擇，不是新發明一個產品規則）。門檻取 spec 指定的「1 cent」
（`0.01`），避免浮點誤差把本該視為「已完整涵蓋」的一天誤判成有缺口。

### 4. 「其他」entry 的日期集合取自不帶 breakdown 的總成本查詢結果，不取自 version 拆分查詢結果

Scenario 3（版本拆分查詢回傳空陣列）時，如果日期集合取自
`version_cost_series`，會因為該陣列本身是空的而無法產出任何
`points`——但驗收條件要求這種情況下仍要有一個涵蓋整個 7 天視窗的
「其他」entry。因此一律以總成本查詢（新增的第三個查詢）的回傳日期為
canonical 日期集合，用「日期字串」而非「list index」去跟 version
拆分的各 series 做比對合併（而不是假設兩次獨立查詢回來的 points 陣列
一定同序同長）——這樣即使 Opik 對兩次請求回傳的 points 順序/數量有
任何細微差異，合併邏輯也不會因為對錯位置而算錯缺口。

### 5. 「其他」entry 固定追加在陣列末端，且只有「至少一天缺口 > 門檻」才出現

- 固定追加在末端（不插入既有 version entries 之間、不排在最前面）：
  保證 Scenario 2（無缺口）時回應與 SDLCCT-47 既有測試逐位元組一致
  （既有測試用 `series[0]["version"] == "..."` 這種位置斷言，任何插入
  既有陣列前段的做法都會讓既有測試連帶需要改動,而 spec 並未要求重新
  排序既有 entries）。
- 固定色票順位（1-N 以外的最後一個中性色）屬於前端呈現細節，spec 已
  明文留給另一張票定案，本文件不涉及、不先行決定一個順位數字。
- 只有缺口 > 門檻時才出現：維持「沒有缺口就不多一個空的/全 null 的
  entry 污染回應」，對應 Scenario 2 的驗收條件。

## UI 原型

無，本 Story 不涉及前端 UI。這是純後端/API response 形狀變更
（`bff/api/agent_detail.py::get_agent_cost_breakdown()` 的
`version_cost_series` 計算邏輯），spec 本身明確寫明「本票不改動任何前端
檔案」「前端 `version-cost-chart.tsx` 不需特別邏輯分辨這個 entry」。對應
的前端顏色/樣式呈現留給另一張票，本票範圍只到 BFF 回應資料正確為止。

## 跨元素樣式耦合測試檢查

本 Story 完全不觸碰 `frontend/`（不新增/修改任何前端檔案、selector 或
computed style）——`version-cost-chart.tsx` 沿用既有渲染路徑，没有任何
樣式變更。已對 `frontend/e2e/` 做過確認性搜尋（`toEqual`/`一致`/
`consistent` 等關鍵字相關的 computed-style 比對測試）：這類測試即使存在，
比對對象也是既有 DOM 元素的樣式，與本票（純後端資料形狀變更、不改
selector、不改樣式）無關，不適用。

## 開放設計問題（定稿時必須為空）

（無）
