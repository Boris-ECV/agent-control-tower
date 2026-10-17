# 設計文件 — SDLCCT-28 Model-switch cost spike detection rule

## 對應需求規格

對應 G1 已核准的需求規格（Jira SDLCCT-28 描述，已內含大部分設計決策與
Demo 資料集的精確數字，本文件為正式化與補齊剩餘實作細節，並對照
`bff/opik_metrics.py`/`bff/baseline.py` 的實際原始碼確認可行性）：偵測
某 Agent 的 model tag 從低成本模型切換為高成本模型、但交易量未明顯變化
的情況。

已用 Demo 資料集驗證的具體事實（`seed/catalog.py`/`seed/generate.py`，
不可更動）：

- `order_status`（`INCIDENTS[2]`，`type="model_switch"`）：基礎 model 為
  `gpt-4o-mini`；`seed/generate.py::cohorts()` 第 73-74 行 `if a.key ==
  "order_status" and d <= 9: return [replace(base, model=
  "claude-sonnet-4-5", version="v2.0")]` —— 即「第 9 天前（含）」切換為
  `claude-sonnet-4-5`，`calls`/`prompt`/`completion` 皆未變動（同一
  `base` cohort，僅 `model` 欄位被 `replace`），對應規格「同一 traffic」。
  `switch_date` = 錨點往前數第 9 天。
- `seed/model_prices.snapshot.json`：`gpt-4o-mini`
  input=0.00000015/output=0.0000006；`claude-sonnet-4-5`
  input=0.000003/output=0.000015 —— 輸入/輸出單價分別貴 20 倍/25 倍，
  與規格給定「deviation_ratio≈21.0」量級一致。
- `seed/generate.py::emit()` 第 147 行：每筆 trace 的 `tags` 固定為
  `["env:prod", f"team:{a.dept_code}", f"model:{co.model}"]` —— 證實
  `model:` 前綴是本故事唯一需要篩選的 tag 命名空間，且同一 trace 僅帶
  一個 `model:` tag（與範圍外「不處理同一天混用兩種以上 model tag」
  一致，生成器本身也從未產出混用資料）。
- 其餘 8 個 agent：`cohorts()` 對它們永遠回傳固定 `base.model`（唯一例外
  是 `quality_rca`/`maintenance_copilot`/`procurement_rfq` 的其他既有
  規則情境，但都不改動 `model` 欄位），故 `switch_date` 永遠為 `null`。

4 條 Gherkin AC：(1) 偵測 `order_status` 真實切換日（第 9 天，
deviation_ratio≈21.0 遠超門檻 3.0）、(2) 其餘 8 個不誤報（switch_date
永遠 null）、(3) 輸出含具體證據（switch_date/before_model_tag/
after_model_tag/before_cost_per_trace/after_cost_per_trace/
deviation_ratio/deviation_threshold 皆非 None）、(4) 查無 dominant tag
改變日期時 `is_anomalous=false`、相關欄位皆為 `null`。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：新增 Opik 後端
endpoint；告警/通知/UI；同日混用兩種以上 model tag 的情況；跨 agent
規則；成本預測/趨勢預測；回溯超過 `HISTORY_DAYS=30` 的資料。

依賴：E2（已 Done）；`bff/opik_metrics.py` 既有
`get_project_metrics_cached()`/`MetricType.COST`/
`MetricType.TRACE_COUNT`/`Interval.DAILY`/
`Breakdown(field=BreakdownField.TAGS)`（SDLCCT-10/11，已確認原始碼可
直接重用，見下方介面契約）；`bff/baseline.py` 僅重用其
`ValueError` 子類別命名慣例（不重用 `compare_to_baseline()` 函式本身，
見下方決策 #2 ——這是規格明確提出的警告：21 天滑動窗會被切換事件本身
污染，因為切換後的天數會被算進「基準」，稀釋或扭曲 deviation_ratio）。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**，延續 SDLCCT-27/31 的定位：純函式庫層
新模組，供未來規則彙整層/排程任務呼叫。

### 新增檔案位置

依 SDLCCT-27 建立、SDLCCT-31 遵循的「每條具體規則一個
`bff/anomaly_<rule_name>.py`」慣例，命名為 **`bff/anomaly_model_switch.py`**：

```
bff/
  opik_metrics.py              # 既有(SDLCCT-10/11),不變動
  baseline.py                   # 既有(SDLCCT-27),不變動 -- 本故事不重用其
                                 # compare_to_baseline()(見決策#2),僅沿用
                                 # ValueError子類別命名慣例
  anomaly_context_bloat.py      # 既有(SDLCCT-27),不變動
  anomaly_governance_gap.py     # 既有(SDLCCT-31),不變動
  anomaly_model_switch.py       # 本 Story 新增:model_switch 規則
  tests/
    test_anomaly_model_switch.py  # developer 依 AC1-4 撰寫(Demo 資料集)
```

### Q1 確認：`BreakdownField.TAGS` 查詢機制（讀 `opik_metrics.py` 原始碼確認）

- `get_project_metrics_cached([project_id], MetricType.TRACE_COUNT,
  interval=Interval.DAILY, interval_start=..., interval_end=...,
  breakdown=Breakdown(field=BreakdownField.TAGS))` 送出的 request body
  僅含 `{"field": "tags"}`（`opik_metrics.py` 第 155-160 行，`TAGS` 分支
  不帶 `metadata_key`）——不能指定「只要 `model:` 這個 tag 命名空間」，
  後端回傳該專案窗口內**觀察到的所有 tag 字串**各自一個 series。
- `_parse_metric_response()`（第 180-196 行）：`key = res.get("name") or
  res["project_id"]`，即每個 `MetricSeries.key` 就是後端回傳的 tag 原始
  字串本身（例如 `"model:gpt-4o-mini"`），不是「tag 命名空間
  +value」的結構化拆解，呼叫端必須自己對 `key` 做前綴比對/切割。
- `seed/generate.py::emit()` 第 147 行每筆 trace 固定帶 3 個 tag
  （`env:prod`/`team:<dept_code>`/`model:<model>`），因此**一次呼叫的
  結果會包含多個 `MetricSeries`**（確認 AC：是，可以），且範圍不限於
  `model:` 前綴——`env:prod`、`team:sa` 等也會各自成為獨立 series。本規則
  必須明確篩選 `key.startswith("model:")` 的 series，忽略其餘。
- 同一個 `model:<value>` series 只會在該 agent 真的使用該 model 的那些
  日期有非 `None`/非零的 `MetricPoint.value`；其餘日期該 series 可能完全
  不含該日期的點，或含值為 `0`/`None` 的點（兩者都視為「該日此 model 無
  流量」，不強制區分，與 SDLCCT-27 決策 #4 的「缺一邊即排除、不猜測」
  精神一致）。

### Q2 確認：尋找 `switch_date` 的演算法——用「當日交易量最高（highest
trace count）」而非「當日成本最高」作為 dominant tag 判定依據

**決策：用 `TRACE_COUNT` 搭配 `BreakdownField.TAGS`（而非 `COST`）判定
每日 dominant model tag。** 理由見下方「關鍵技術決策 #1」——用成本判定
dominant tag 會讓「用來定位切換日」的訊號本身就混入「切換後成本變貴」
這個我們正要偵測的效應，邏輯上循環；交易量（trace count）直接反映
「當天流量實際由哪個 model 服務」，與切換前後是否貴無關，是更乾淨的
訊號，也符合規格「交易量未明顯變化」這個判定前提本身就假設交易量是
穩定、可信的量尺。

演算法（`_find_switch_date()`，內部 helper）：

```python
MODEL_TAG_PREFIX = "model:"

def _find_switch_date(trace_count_series: tuple[MetricSeries, ...]):
    """回傳 (switch_date, before_tag, after_tag, total_traces_by_date)。
    switch_date 為 None 時 before_tag/after_tag 亦為 None(AC4)。
    """
    model_series = [s for s in trace_count_series if s.key.startswith(MODEL_TAG_PREFIX)]

    # date -> {model_value: count}，略過 None 值(SDLCCT-27決策#5同一慣例)
    by_date: dict[date, dict[str, float]] = defaultdict(dict)
    for s in model_series:
        model_value = s.key[len(MODEL_TAG_PREFIX):]
        for p in s.points:
            if p.value is not None:
                by_date[p.time.date()][model_value] = p.value

    total_traces_by_date: dict[date, float] = {
        d: sum(counts.values()) for d, counts in by_date.items() if counts
    }
    dominant_by_date: dict[date, str] = {
        d: max(counts.items(), key=lambda kv: kv[1])[0]
        for d, counts in by_date.items() if counts
    }

    prev_date, prev_tag = None, None
    for d in sorted(dominant_by_date):
        tag = dominant_by_date[d]
        if prev_tag is not None and tag != prev_tag:
            return d, prev_tag, tag, total_traces_by_date
        prev_date, prev_tag = d, tag
    return None, None, None, total_traces_by_date
```

- 「找不到 dominant tag 改變的日期」= 迴圈跑完都沒有回傳（全程只有一個
  model tag，或完全沒有資料）→ `(None, None, None, ...)`，直接對應 AC4。
- 範圍外明確排除「同一天混用兩種以上 model tag」，故 `max()` 的平手情況
  不會在 Demo 資料集發生；若未來真的平手，`max()` 取字典序最先出現的
  一個，是防禦性處理、不是本故事要解決的情境。

### Q3 確認：before/after cost-per-trace 的計算——兩個互斥同質子窗口，
**不**用 `compare_to_baseline()`

規格明確警告：`compare_to_baseline()` 的 21 天滑動窗以 `target_date`
為錨點往前連續取 N 天做平均，若 `target_date` 選在切換後，21 天基準窗
會整段或部分落在切換後（同一個高成本 model 的天數），不是「切換前」的
乾淨基準；若選在切換前，則拿不到切換後的「實際值」。**兩個階段的模型各
自同質，必須用兩個互斥、以 `switch_date` 為分界的子窗口分別加總，而非
滑動平均。**

```python
MODEL_SWITCH_DEVIATION_THRESHOLD = 3.0

def _cost_per_trace(
    daily_cost: Mapping[date, float | None],
    total_traces_by_date: Mapping[date, float],
    dates: Iterable[date],
) -> tuple[float, float]:
    """回傳 (total_cost, total_traces)，加總僅限兩邊皆有非None資料的日期
    (SDLCCT-27決策#4同一「缺一邊即整天排除」慣例)。"""
    total_cost, total_traces = 0.0, 0.0
    for d in dates:
        cost, traces = daily_cost.get(d), total_traces_by_date.get(d)
        if cost is None or traces is None:
            continue
        total_cost += cost
        total_traces += traces
    return total_cost, total_traces
```

`before` 子窗口 = `[interval_start.date(), switch_date - 1 day]`；
`after` 子窗口 = `[switch_date, interval_end.date()]`。
`before_cost_per_trace = before_total_cost / before_total_traces`；
`after_cost_per_trace` 同理。`total_traces_by_date` 直接重用 Q2 演算法
已經算出的「當日所有 `model:` series 加總」，**不需要第三次查詢**——
因為範圍外已排除混用情境，`model:` 系列加總即等於當日總 trace 數，省下
一次多餘的無拆解 `TRACE_COUNT` 呼叫。

若 `before_total_traces == 0`、`after_total_traces == 0`，或
`before_cost_per_trace == 0`（除法未定義），拋出下方決策 #2 的
`InsufficientSwitchWindowDataError`，絕不回傳 0 或猜測值（CONSTITUTION.md
「Failure handling」：「a missing number looks identical to "no cost"」）。

### `bff/anomaly_model_switch.py`：完整介面

```python
"""Model-switch cost spike anomaly rule (SDLCCT-28): detects an agent's
model tag changing from a cheaper to a more expensive model with no
corresponding change in traffic volume.

Deliberately does NOT reuse bff.baseline.compare_to_baseline(): its
trailing N-day sliding-average baseline would be polluted by the switch
event itself (the baseline window would span across switch_date). This
rule instead splits the query window into two mutually exclusive,
model-homogeneous sub-windows at switch_date and sums cost/traces within
each -- see docs/design/SDLCCT-28.md Q3.
"""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from opik_metrics import (
    Breakdown,
    BreakdownField,
    Interval,
    MetricSeries,
    MetricType,
    get_project_metrics_cached,
)

MODEL_TAG_PREFIX = "model:"
MODEL_SWITCH_DEVIATION_THRESHOLD = 3.0


class InsufficientSwitchWindowDataError(ValueError):
    """Raised when a switch_date was found but the before- or after-switch
    sub-window has no usable (cost, trace_count) data to compute a
    before/after cost-per-trace -- see docs/design/SDLCCT-28.md decision
    #2 for why this is its own class rather than reusing
    bff.baseline.InsufficientBaselineDataError or any bff.opik_metrics
    exception."""


@dataclass(frozen=True)
class ModelSwitchFinding:
    project_id: str
    is_anomalous: bool
    deviation_threshold: float
    switch_date: date | None
    before_model_tag: str | None
    after_model_tag: str | None
    before_cost_per_trace: float | None
    after_cost_per_trace: float | None
    deviation_ratio: float | None


def detect_model_switch(
    project_id: str,
    *,
    interval_start: datetime,
    interval_end: datetime,
    deviation_threshold: float = MODEL_SWITCH_DEVIATION_THRESHOLD,
) -> ModelSwitchFinding:
    """Always returns a ModelSwitchFinding (never None) -- same
    "explain a non-anomaly too" convention as detect_context_bloat()
    (SDLCCT-27 decision #6) and find_governance_gaps() (SDLCCT-31).

    - Queries TRACE_COUNT (DAILY, Breakdown(TAGS)) and COST (DAILY, no
      breakdown), both for [project_id] only, over
      [interval_start, interval_end]. Any OpikConfigError/OpikHTTPError/
      OpikTimeoutError/OpikResponseFormatError/MissingProjectIdsError
      from either call propagates unchanged -- not caught here.
    - If no dominant-tag change is found in the window: returns
      is_anomalous=False, switch_date=None, and every other evidence
      field None (AC4). This is NOT an error -- it is the expected
      result for 8 of the 9 Demo agents.
    - If a switch_date is found but a sub-window has no usable data:
      raises InsufficientSwitchWindowDataError (never a guessed ratio).
    - is_anomalous = deviation_ratio >= deviation_threshold (>=, same
      boundary convention as detect_context_bloat()/AC6 there; this
      ticket's AC list has no explicit boundary case, so the existing
      repo-wide convention applies -- see decision #4).
    """
```

### AC 對應關係

| AC | 對應設計 |
|---|---|
| 1. 偵測 `order_status` 真實切換日（第9天,deviation_ratio≈21.0 遠超門檻3.0） | `_find_switch_date()` 在第 9 天發現 dominant tag 由 `gpt-4o-mini`→`claude-sonnet-4-5`；兩子窗口 cost-per-trace 比值 ≈21.0 ≥ `deviation_threshold=3.0` → `is_anomalous=True` |
| 2. 其餘8個agent不誤報（switch_date永遠null） | 這些 agent 的 `TRACE_COUNT`+`TAGS` 拆解中只會出現一個 `model:` series（`cohorts()` 從未對它們 `replace(model=...)`），`_find_switch_date()` 迴圈跑完無變化 → `(None,None,None,...)` |
| 3. 輸出含具體證據（7 個欄位皆非 None） | `ModelSwitchFinding` 的 `switch_date`/`before_model_tag`/`after_model_tag`/`before_cost_per_trace`/`after_cost_per_trace`/`deviation_ratio`/`deviation_threshold` 在 `is_anomalous=True` 時原樣攜帶兩子窗口算出的真實數字 |
| 4. 查無 dominant tag 改變日期時 `is_anomalous=false`、相關欄位皆 null | `_find_switch_date()` 回傳 `(None,None,None,...)` 時，`detect_model_switch()` 直接建構 `ModelSwitchFinding(switch_date=None, before_model_tag=None, after_model_tag=None, before_cost_per_trace=None, after_cost_per_trace=None, deviation_ratio=None, is_anomalous=False)`，不嘗試呼叫 `_cost_per_trace()` |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`ModelSwitchFinding`
是記憶體內的回應型別（frozen dataclass），生命週期僅限於一次規則判定
呼叫，與 SDLCCT-10/15/17/27/31 的資料模型決策一致。

## 關鍵技術決策

### 1. 用 `TRACE_COUNT`（交易量）而非 `COST`（花費）判定每日 dominant
model tag

若改用「當日花費最高的 model tag」判定 dominant，會讓判定依據本身混入
「切換後成本變貴」這個我們正要偵測的效應——即使某天切換後只跑了極少
幾筆（交易量仍以舊 model 為主），只要新 model 單價夠貴，花費就可能已經
超過舊 model 當天全部流量的花費，導致「dominant tag」在交易量尚未真正
切換前就被成本提前判定切換，產生比實際切換日更早、且理由循環
（用成本判定「成本異常的起點」）的錯誤。交易量是獨立於單價的訊號，直接
反映「當天流量實際由哪個 model 服務」，與規格「交易量未明顯變化」這個
判定前提一致（這個前提本身就假設交易量是穩定、可信的量尺，不應該讓
它又被拿來当作判定材料的訊號污染）。

### 2. 新增 `InsufficientSwitchWindowDataError(ValueError)`，不重用
`bff.baseline.InsufficientBaselineDataError`，也不重用
`bff.opik_metrics` 的例外類別

延續 SDLCCT-27 決策 #2 的判斷方式：`bff.opik_metrics` 的
`OpikClientError` 家族語意綁定「對後端發出了一次請求，而這次請求失敗」
（強制要求 `endpoint` 參數），本情境是查詢全部成功、純粹是「算出來的
子窗口沒有可用資料」，套用會編造不存在的 `endpoint`。
`InsufficientBaselineDataError` 語意上確實也是「資料不足以算出有意義的
比較值」，表面相近，但它的 docstring 明確綁定 `compare_to_baseline()`
自己的三個具體條件（`target_date` 本身無值 / 基準窗零可用天數 / 基準
平均恰為 0），且本故事明確地**不呼叫** `compare_to_baseline()`（規格的
警告正是這一點）——借用一個文件化綁定於另一個函式具體條件的例外類別，
會讓未來讀者誤以為本規則內部呼叫了 `compare_to_baseline()`，或誤以為
兩者的「不足」條件完全相同（實際上本規則的條件是「某個子窗口總流量
為 0」或「before 子窗口 cost-per-trace 恰為 0」，與 `compare_to_baseline()`
的三個條件字面上不同）。因此新增一個最小的專用類別，繼承 `ValueError`
（延續 `MissingProjectIdsError`/`InsufficientBaselineDataError` 的
「呼叫端資料契約違反用 `ValueError` 子類別」慣例），只在本模組使用。

### 3. `_find_switch_date()` 直接從 `TRACE_COUNT`+`TAGS` 的查詢結果重算
「當日總交易量」，不另外呼叫無拆解的 `TRACE_COUNT`

範圍外已明確排除「同一天混用兩種以上 model tag」的情況，也已用
`seed/generate.py::emit()` 原始碼確認生成器本身從未產出混用資料——因此
「當日所有 `model:` 前綴 series 的值加總」在這個資料集的事實保證下，
就等於「當日總交易量」，不需要為了拿「總交易量」再發一次無拆解的
`TRACE_COUNT` 查詢。這比照 SDLCCT-31 決策「只對篩出子集合呼叫一次
`get_workspace_daily_costs()`」的省查詢精神——本故事對同一個
project_id 總共只查 2 次（`TRACE_COUNT`+`TAGS`、`COST` 無拆解），比
SDLCCT-27 的 context_bloat 規則同樣是 2 次查詢。

### 4. `is_anomalous = deviation_ratio >= deviation_threshold`（`>=`）

本故事的 4 條 AC 沒有明確的門檻邊界案例（不像 SDLCCT-27 AC6／
SDLCCT-29 AC4／SDLCCT-30 AC5 都明確指定邊界值視為異常），但
`detect_context_bloat()`（SDLCCT-27）已確立 repo 內「邊界值算異常」的
`>=` 慣例；依 CONSTITUTION.md「Code style」「Follow the conventions
already present in the code」，沿用同一慣例而非另外發明 `>`，避免同一個
規則家族（`bff/anomaly_*.py`）出現不一致的邊界語意。

### 5. `detect_model_switch()` 永遠回傳 `ModelSwitchFinding`，不回傳
`None`，「找不到切換」不是錯誤

延續 SDLCCT-27 決策 #6／SDLCCT-31 的既有慣例：AC2/AC4 要求「其餘 8 個
不誤報、相關欄位皆為 null」，這是正常、預期的結果（9 個 agent 中 8 個
本就不該被標記），不是資料不足或查詢失敗，因此用
`is_anomalous: bool` + 其餘欄位皆 `None` 表達，而非拋例外或回傳 `None`
掩蓋掉「這個 agent 被完整檢查過、確實沒有異常」這個事實。

### 6. `MetricPoint.value` 的 `None` 從頭到尾不被強制轉成 `0`/`0.0`

延續 SDLCCT-10/27 的既有決策：`_find_switch_date()`／`_cost_per_trace()`
兩層都明確以 `is None` 排除、絕不把缺失值當 0 參與加總或除法——缺一邊
就讓那一天整天從加總中消失（而非讓它把 `total_traces`/`total_cost`
拉低），與 SDLCCT-27 決策 #4/#5 完全一致的作法。

## UI 原型

無，本 Story 不涉及前端 UI——純粹是服務層的 Python 規則判定函式，沒有
新增或變更任何畫面、元件或樣式。Portal 畫面本身尚未存在，其 UI 技術
選型是未排程的未來故事的範圍，非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/17/27/31 設計
文件記錄的狀況相同，此後未變。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題(定稿時必須為空)

(無)
