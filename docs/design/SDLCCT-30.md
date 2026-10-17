# 設計文件 — SDLCCT-30 Nighttime batch burst anomaly detection rule

## 對應需求規格

對應 G1 已核准的需求規格（Jira SDLCCT-30 / `docs/PRD.md` 同名段落）：新增
一條「非營業時段流量暴增」異常偵測規則，用 Opik `TRACE_COUNT`（`HOURLY`）
比對 Agent 自身基準小時流量，並以 `metadata.workflow` 作為佐證，驗證標的
是 Demo 資料集中 `procurement_rfq` 的真實夜間批次重跑事件
（`seed/catalog.py` `INCIDENTS[3]`：`start_days_ago=4`，`seed/generate.py`
`cohorts()`：`d==4` 時疊加 `count=600`、`hours=(17, 19)`、
`workflow="rfq_batch_rerun"`、`trigger="scheduler"` 的 cohort）。

**本文件所列函式介面逐字採用 Jira G1 已核准的規格原文**（orchestrator 持有
完整 Jira 存取權，已核對）：單一 `project_id` 輸入、單一 `NightBatchBurstFinding`
輸出——與 SDLCCT-27 `detect_context_bloat()` 同一形狀，不是 SDLCCT-31
`find_governance_gaps()` 的批量形狀（本文件初版曾誤判為批量形狀，已依
orchestrator 核對 Jira 原文後更正，見下方「關鍵技術決策 #1」）。

已從 repo 既有事實確認（不可更動的具體參數）：

- `procurement_rfq`（`seed/catalog.py`）：`base_traces=25`、
  `hours=(0, 10)`（UTC，預設營業時段=台灣 08:00-18:00），即平常流量完全
  不落在 UTC 17-19 這個離峰窗口。
- `d=4` 當天額外疊加一個 `hours=(17, 19)`、`count=600` 的 cohort（
  `seed/generate.py` `cohorts()`），`workflow="rfq_batch_rerun"`。
  `seed/generate.py` 第 183-187 行確認 `hours` 是半開區間
  `[hours[0]*3600, hours[1]*3600)`，用於把該 cohort 的 600 筆 trace
  均勻灑在 UTC 17:00-19:00 這 2 小時內——不會外溢到其他小時。
- `其餘 8 個 agent`：均無任何 `hours=(17,19)` 或其他離峰窗重疊的 cohort，
  離峰窗口內之流量在歷史上恆為 0 或極小雜訊（僅 `supply_risk_monitor`/
  `temp_supplier_scraper` 的 `hours=(0,24)` 會在離峰窗內有少量基礬內的
  正常流量，但其 24 小時基準本身已涵蓋離峰窗，比值不會異常放大）。
- PRD 摘要給定的驗證數字：`procurement_rfq` 的 `ratio≈290-353`（遠超門檻
  10）；其餘 8 個 agent 最大比值約 1（`margin>=9`）；
  `off_hours_trace_count=600`、`corroborating_workflow="rfq_batch_rerun"`；
  門檻邊界 `ratio==10` 視為異常；`project_id` 傳空字串（或底層查詢的
  `project_ids` 為空）時拋 `MissingProjectIdsError`，不回傳猜測值。

5 條 Gherkin AC（PRD 摘要；Jira 原文確認：AC1/AC2 是對 9 個 agent **各自
個別呼叫**本函式驗證，不是一次批量呼叫）：(1) 偵測 `procurement_rfq` 真實
暴增、(2) 其餘 8 個分別呼叫皆不誤報、(3) 輸出含具體證據與佐證 metadata
（`off_hours_trace_count`、`baseline_hourly_rate`、`ratio`、
`corroborating_workflow`）、(4) `project_ids` 為空拋例外、(5) 門檻邊界
（`ratio==10` 視為異常）。

範圍外（PRD 已定案，不可擴大，本文件不觸碰）：畫面呈現；自動處置；AI 生成
文字說明；`workflow` metadata 佐證本身作為獨立判異門檻（它只能佐證，不能
單獨觸發 `is_anomalous`）；離峰時段窗口本身的自動偵測/推斷（窗口由呼叫端
明確傳入，本規則不猜測）。

依賴：E2（已 Done）；`bff/opik_metrics.py` 既有 `get_project_metrics_cached()`
（`MetricType.TRACE_COUNT`、`Interval.HOURLY`/`DAILY`/`TOTAL`、
`BreakdownField.METADATA`，SDLCCT-10/11）；延續 SDLCCT-27/31 建立的
`bff/anomaly_<rule_name>.py` 分檔慣例。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**，延續 SDLCCT-27/31 的定位：純函式庫層
模組，供未來規則彙整層/排程任務呼叫。

### 新增檔案：`bff/anomaly_night_batch_burst.py`

依 SDLCCT-27 建立、SDLCCT-31 沿用的「每條規則一個
`bff/anomaly_<rule_name>.py`」慣例命名。本規則**不需要** `bff/baseline.py`
的 `compare_to_baseline()`（見下方「關鍵技術決策 #2」為什麼不重用），
是一個獨立、無額外共用模組依賴的規則檔案，只依賴
`bff/opik_metrics.py` 既有的 `get_project_metrics_cached`/`MetricType`/
`Interval`/`Breakdown`/`BreakdownField`/`MetricSeries`/`MissingProjectIdsError`。

簽名與回傳形狀採**單一 `project_id` 輸入、單一 `NightBatchBurstFinding`
輸出**——與 SDLCCT-27 `detect_context_bloat()` 同一形狀，不是 SDLCCT-31
`find_governance_gaps()` 的批量形狀（理由見下方「關鍵技術決策 #1」）。
以下簽名逐字對應 Jira 已核准規格：

```python
"""Nighttime batch burst anomaly detection rule (SDLCCT-30): off-hours
TRACE_COUNT surge vs. this project's own 24h-uniform baseline rate, with
metadata.workflow as corroborating (never gating) evidence.

Built directly on bff.opik_metrics.get_project_metrics_cached() -- does
NOT reuse bff.baseline.compare_to_baseline(): see
docs/design/SDLCCT-30.md decision #2 for why this rule's baseline
arithmetic (daily total / 24) is a different, simpler shape than
compare_to_baseline()'s day-over-day comparison, so there is no shared
"InsufficientBaselineDataError"-style failure mode to reuse.
"""

from dataclasses import dataclass
from datetime import date, datetime

from opik_metrics import (
    Breakdown,
    BreakdownField,
    Interval,
    MetricType,
    MissingProjectIdsError,
    get_project_metrics_cached,
)

NIGHT_BATCH_BURST_WINDOW_HOURS_UTC: tuple[int, int] = (17, 19)
NIGHT_BATCH_BURST_RATIO_THRESHOLD: float = 10.0
_METADATA_WORKFLOW_KEY = "workflow"  # not a parameter -- see decision below


@dataclass(frozen=True)
class NightBatchBurstFinding:
    project_id: str
    is_anomalous: bool
    ratio_threshold: float
    off_hours_window_utc: tuple[int, int]
    off_hours_trace_count: int
    baseline_hourly_rate: float
    ratio: float
    corroborating_workflow: str | None  # evidence only -- never read by is_anomalous


def detect_night_batch_burst(
    project_id: str,
    *,
    target_date: date,
    interval_start: datetime,
    interval_end: datetime,
    off_hours_window_utc: tuple[int, int] = NIGHT_BATCH_BURST_WINDOW_HOURS_UTC,
    baseline_window_days: int = 21,
    ratio_threshold: float = NIGHT_BATCH_BURST_RATIO_THRESHOLD,
) -> NightBatchBurstFinding:
    """Always returns a NightBatchBurstFinding (never None) -- same
    "explain-your-reasoning even when not anomalous" contract as
    SDLCCT-27's detect_context_bloat().

    - Calls get_project_metrics_cached([project_id], TRACE_COUNT,
      interval=HOURLY, interval_start=target_date@off_hours_window_utc[0]:00
      UTC, interval_end=target_date@off_hours_window_utc[1]:00 UTC) and
      sums the hourly points into off_hours_trace_count (missing/None
      hours counted as 0 -- see decision #4 for why this one metric
      type is an explicit, grounded exception to the repo's general
      "None never becomes 0" convention).
    - Calls get_project_metrics_cached([project_id], TRACE_COUNT,
      interval=DAILY, interval_start=interval_start,
      interval_end=interval_end) to obtain this agent's own daily
      TRACE_COUNT series; selects the baseline_window_days calendar
      dates immediately before target_date (target_date itself
      excluded, same convention as bff.baseline.compare_to_baseline()),
      averages the non-None values, divides by 24 ->
      baseline_hourly_rate. interval_start/interval_end are caller-
      supplied and must cover at least [target_date -
      baseline_window_days, target_date) -- this function never reads
      the system clock or widens the window itself (same "caller
      supplies a wide-enough window" contract as detect_context_bloat()).
    - ratio = (off_hours_trace_count / window_hours) /
      baseline_hourly_rate, where window_hours =
      off_hours_window_utc[1] - off_hours_window_utc[0]; is_anomalous =
      ratio >= ratio_threshold (>=, so exactly 10.0 counts as
      anomalous -- AC5).
    - Also calls get_project_metrics_cached([project_id], TRACE_COUNT,
      interval=TOTAL, interval_start/interval_end = the same off-hours
      window as the first call, breakdown=Breakdown(METADATA,
      metadata_key="workflow")); the workflow with the highest total
      value becomes corroborating_workflow (None if no series, or all
      totals are 0/None). Never affects is_anomalous (decision #3).
    - project_id wrapped as [project_id] for every
      get_project_metrics_cached() call; MissingProjectIdsError and any
      OpikConfigError/OpikHTTPError/OpikTimeoutError/
      OpikResponseFormatError from any of the 3 calls propagate
      unchanged (consistent with every existing rule in this module
      family -- no new exception type, see decision #2).
    - If baseline_hourly_rate works out to 0 (no non-None baseline day,
      or their average is exactly 0), raises a plain ValueError naming
      project_id -- a defensive division-by-zero guard, not a new
      dedicated exception class (decision #2): not expected to trigger
      against the validated Demo dataset (every one of the 9 agents has
      nonzero daily traffic throughout the 30-day history).
    """
```

### AC 對應關係

| AC | 對應設計 |
|---|---|
| 1. 偵測 `procurement_rfq` 真實暴增（`ratio≈290-353` 遠超門檻 10） | 以 `project_id="procurement_rfq"` 呼叫：`off_hours_trace_count=600`（`seed/generate.py` d=4 cohort 原樣落在查詢窗口內）；`baseline_hourly_rate`≈`base_traces(25)×jitter/24`≈1.0-1.1；`ratio = (600/2) / baseline_hourly_rate` ≈ 290-353（隨 21 天基準窗內的 jitter 浮動）≥ 10 → `is_anomalous=True` |
| 2. 其餘 8 個分別呼叫皆不誤報（最大比值約 1，margin≥9） | 對其餘 8 個 `project_id` **各自個別**呼叫同一函式；離峰窗口內無額外 cohort，`off_hours_trace_count` 僅為基準流量在該 2 小時內的自然份額，`ratio≈1` < 10 → `is_anomalous=False` |
| 3. 輸出含具體證據與佐證 metadata | `NightBatchBurstFinding` 原樣攜帶 `off_hours_trace_count`/`baseline_hourly_rate`/`ratio`/`corroborating_workflow`，呼叫端不需重新計算；`corroborating_workflow="rfq_batch_rerun"` 來自 metadata breakdown 查詢 |
| 4. `project_ids` 為空拋例外 | `[project_id]` 傳入 `get_project_metrics_cached()` 的三次呼叫沿用其既有 `MissingProjectIdsError` 契約；見下方「關鍵技術決策 #5」說明此函式本身為單一 `project_id` 簽名下，此例外觸發的實際條件 |
| 5. 門檻邊界（`ratio==10` 視為異常） | `is_anomalous = ratio >= ratio_threshold`，用 `>=` 而非 `>` |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`NightBatchBurstFinding`
是記憶體內的回應型別（frozen dataclass），生命週期僅限於一次規則判定呼叫，
與 SDLCCT-10/27/31 的資料模型決策一致。

## 關鍵技術決策

### 1. 單一 `project_id` 輸入/輸出形狀，不是 SDLCCT-31 的批量形狀（修正記錄）

本文件初版誤判此規則應採 SDLCCT-31 `find_governance_gaps()` 的批量
（`Sequence[str]` → `tuple[Finding, ...]`）形狀，理由是「AC4 的‘project_ids
為空拋例外’措辭像複數輸入」。經 orchestrator 核對 Jira 原文核准規格後
更正：Jira 的 5 條 Gherkin AC 對 AC1/AC2 的描述是「對 `procurement_rfq`
與其餘 8 個 agent **各自個別**呼叫」，與 SDLCCT-27 `detect_context_bloat()`
單一 `project_id` 形狀一致，不是 SDLCCT-31 的批量形狀。兩者的關鍵差異：
SDLCCT-31 的批量理由是「`get_workspace_daily_costs(project_ids, ...)`
本身設計成接受一個清單、一次 POST 打 `/v1/private/workspaces/costs`
批次端點」，批量能省下真實的 N-1 次 HTTP round-trip；本規則呼叫的
`get_project_metrics_cached()` 無論單一 `project_id` 或多個，都是「每個
`project_id` 各自一次 HTTP 請求」（`opik_metrics.py` `get_project_metrics()`
docstring：「Query one project's metrics endpoint for each id in
project_ids, explicitly」），批量呼叫在這個端點上**不會**省下任何
round-trip——和 SDLCCT-31 依賴的批次端點行為不同，沒有對應的批量效益
論證，因此沒有理由偏離 Jira 原文給定的單一 `project_id` 形狀。

### 2. 不重用 `bff/baseline.py` 的 `compare_to_baseline()`，不新增專用例外類別

`compare_to_baseline()` 的語意是「單一每日數值序列，跟自己過去 N 天的*同一
種每日數值*平均比較」（day-over-day）。本規則的基準是「把 DAILY 總量平均
除以 24，推算出一個*假設流量全天均勻分布*的小時基準」，再拿「離峰窗口的
*實際小時總和*」去跟這個基準小時率比——比較的兩個數字（每日總量的平均 vs.
兩小時窗口的加總）不是同一種粒度，硬套
`compare_to_baseline(daily_values, target_date, baseline_window_days)`
的介面（它假設 `target_date` 當天也有一個「每日值」要跟基準比）會要求先把
「離峰窗口總和」偽裝成一個「每日值」，語意上是錯的（那天的每日總量其實是
`base_traces + 600`，不是我們真正想比較的數字）。因此本規則自己實作一段
精簡的「DAILY 平均 ÷ 24」基準計算，不經過 `compare_to_baseline()`，也因此
不會觸發它的 `InsufficientBaselineDataError` 失敗模式——沒有共用的失敗
語意可以重用，新增一個專用例外類別反而只服務這一條規則、沒有未來規則會
重用它（不像 `baseline.py` 本身被設計成通用元件），故只用一個行內的
`ValueError`（見介面契約 docstring 最後一段），不建立新類別。既有
`bff.opik_metrics` 的 `MissingProjectIdsError`/`OpikClientError` 系列例外
則原樣往外傳，不捕捉、不轉譯（延續 SDLCCT-27/31 兩篇設計文件的既有慣例）。

### 3. `corroborating_workflow` 永遠只是佐證欄位，絕不影響 `is_anomalous`

PRD 範圍外明確排除「`workflow` metadata 佐證本身作為獨立判異門檻」。
`is_anomalous` 的計算完全由 `ratio >= ratio_threshold` 決定，`metadata`
breakdown 查詢即使空手而回（`corroborating_workflow=None`）也不改變
`is_anomalous` 的判定——這與 AC3 的「提供證據」訴求（供人類/未來報表理解
「為什麼」）和範圍外的「不作為判異依據」訴求同時成立，兩者不衝突：
`is_anomalous` 只讀 `ratio`，`corroborating_workflow` 只是額外隨附的解釋性
欄位，不是參數（`metadata_key="workflow"` 寫死為模組內常數，因為 Jira
規格與 AC3 都只提到 `workflow` 這一個 metadata key，沒有要求可由呼叫端
覆寫，比照 SDLCCT-31 `find_governance_gaps()` 不把內部查哪個欄位開放成
參數的同一精神——需要查別的 metadata key 時再開放，不預先過度設計）。

### 4. `off_hours_trace_count` 加總時，`None`/缺席小時計為 `0`——與 `opik_metrics.py` 既有「`None` 絕不轉 `0`」慣例的刻意例外，具體理由如下

`bff/opik_metrics.py` 的既有慣例、SDLCCT-27 決策 #5 延續的「`None` 從頭到
尾不被強制轉成 `0.0`」，其**理由**明文寫在 `MetricPoint.value` 的註解：
`None = "unknown" (missing provider/model/usage)`——也就是「這個數字存在，
只是因為缺少 provider/model 定價表或用量紀錄而查不到」，這個成因**只對
`COST`/`SPAN_TOKEN_USAGE` 這類依賴外部定價/用量資訊才能算出的指標有意義**。
`TRACE_COUNT` 沒有這個成因：它是 Opik 後端對「這個時間桶內實際寫入的
trace 紀錄筆數」做計數，而這些 trace 紀錄是 `seed/ingest.py`
`post_all()` 把 `seed/generate.py` 產生的真實資料以其原始時間戳記寫入
Opik 的標準 trace 寫入 API（不是依賴另一張可能缺值的定價/用量對照表）。
因此，在本故事驗證的 Demo 資料集情境下，離峰窗口內任一小時「沒有回傳資料
點」或「回傳 `null`」，唯一合理的成因就是「那個小時確實沒有任何已寫入的
trace」——是一個*已知*的真實零值，不是「未知」。把它當 `0` 參與加總，
反映的是後端對「零筆計數」的真實回應，不是捏造一個不存在的事實；這點與
`COST`/`SPAN_TOKEN_USAGE` 的 `None`（真實數值存在、只是查不到）在成因上
完全不同，因此只在 `TRACE_COUNT` 的加總語境下刻意偏離「`None` 永不轉 `0`」
的既有慣例，不影響 `baseline.py`/`anomaly_context_bloat.py` 處理
`SPAN_TOKEN_USAGE`/`COST` 時的既有規則。DAILY 基準查詢的每日值則保留現有
慣例處理方式：缺席/`None` 的日期直接從平均中排除，不計為 `0`——因為那裡
的「排除 vs. 計為 0」會直接改變「這一天算不算進基準」這個布林式判斷（進而
影響 decision #2 提到的除以零防呆），與離峰窗口加總（只是把已知有限的
2 個小時點加總成一個總數）在影響範圍上性質不同：一個是「平均的分母要不要
納入」，另一個只是「加總時這一項算 0 還是跳過，數學上等價」。

### 5. 單一 `project_id` 形狀下，`MissingProjectIdsError` 的實際觸發條件

由於本函式簽名是單一 `project_id: str`（不是 `Sequence[str]`），傳給
`get_project_metrics_cached()` 的永遠是 `[project_id]`——只要 `project_id`
是一個非空字串，這個清單本身永不為空，`MissingProjectIdsError`（其語意是
「`project_ids` 這個*清單*為空」）在正常呼叫下不會被觸發。AC4「`project_ids`
為空拋例外」這條驗收條件因此落在**下游 `get_project_metrics_cached()`
本身**的既有契約上，而不是本函式新增的檢查邏輯——本函式不做任何關於
`project_id` 是否為空字串的額外防呆（沿用 SDLCCT-27/31「不自己發明一套新
的輸入驗證，讓既有例外原樣傳遞」的慣例），这與 Jira 規格把此例外描述為
「現有例外，原樣傳遞」而非「本故事新增的檢查」一致。

## UI 原型

無，本 Story 不涉及前端 UI——純粹是服務層的 Python 規則判定函式，沒有
新增或變更任何畫面、元件或樣式。Portal 畫面本身尚未存在，其 UI 技術選型
是未排程的未來故事的範圍，非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/17/27/31 設計
文件記錄的狀況相同，此後未變。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題(定稿時必須為空)

(無)
