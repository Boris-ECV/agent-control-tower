# 設計文件 — SDLCCT-69 異常與告警頁面：資料不足不應顯示為紅色錯誤

## 對應需求規格

G1 已核准之定稿需求(摘要):「異常與告警」頁面中,當某 Agent 在某條規則上純粹因
「沒有可用資料可比對」(無當日資料、baseline 窗口無資料、或 baseline 平均為 0)
而無法計算時,畫面上不應出現 `status="error"` 的紅色錯誤卡片,應視同「無異常」
(不產生列)。根因已定位在 `bff/api/anomalies.py` 的 `except Exception` 把「資料
不足」與「規則引擎真正壞掉」一視同仁。6 條 Gherkin AC 已定稿,詳見 ticket;範圍
明確排除:不改前端、不改 `anomaly_night_batch_burst.py`/`anomaly_governance_gap.py`、
不新增第三種 status 值、不變更 `baseline.py` 本身的門檻邏輯。

## 介面/API 契約

**`GET /api/anomalies` 的公開回應形狀本身不變。** 仍是
`{"anchor_date": str, "anomalies": [{"agent", "anomaly_type", "date", "status",
"reason"}, ...]}`,`status` 仍只有 `"ok"` / `"error"` 兩種值(不新增第三種),每個
row 的欄位結構與 `docs/design/SDLCCT-51.md` 完全一致。

**本次變更的唯一效果是:哪些列會被產生。** 具體而言:

| 規則函式 | 觸發條件 | 修正前行為 | 修正後行為 |
|---|---|---|---|
| `_run_target_date_rule`(供 tool_retry_loop / context_bloat / night_batch_burst 共用) | 底層 `detect_fn` 拋出 `InsufficientBaselineDataError`(來自 `bff/baseline.py`)或 `MissingErrorRateDataError`(來自 `bff/anomaly_tool_retry_loop.py`) | 產生 1 列 `status="error"` | **不產生列**(視同 AC2 的「不是異常」路徑) |
| `_run_target_date_rule` | 底層 `detect_fn` 拋出任何其他例外(含一般 `ValueError`、`RuntimeError`...) | 產生 1 列 `status="error"`,`reason=str(exc)` | **不變**(維持 SDLCCT-51 AC6) |
| `_run_model_switch` | `detect_model_switch` 拋出 `InsufficientSwitchWindowDataError`(來自 `bff/anomaly_model_switch.py`) | 產生 1 列 `status="error"` | **不產生列** |
| `_run_model_switch` | 任何其他例外 | 產生 1 列 `status="error"` | **不變** |
| `_run_governance_gaps` | 任何例外 | 產生 1 列 `status="error"`,`agent=null` | **不變**(此函式無對應的「資料不足」例外類別,AC5 範圍外) |

沒有新端點、沒有新 query 參數、沒有新 response 欄位。

## 資料模型

無新增資料模型。本story不觸及任何資料表/schema;`bff/api/anomalies.py` 回應的
`anomalies[]` row 形狀維持 SDLCCT-51 定義不變(見上節)。

## 關鍵技術決策

1. **用「顯式例外型別 tuple,只在 `bff/api/anomalies.py` 內 catch」,不新增共用
   base class。**
   - 三個既有例外類別(`InsufficientBaselineDataError`、
     `MissingErrorRateDataError`、`InsufficientSwitchWindowDataError`)各自的
     docstring 都已經**明確記錄了「為什麼這是獨立的類別,而不是重用其他類別」**
     的理由(分別來自 SDLCCT-27/28/29 三個獨立定稿的設計決策,例如
     `InsufficientSwitchWindowDataError` 的 docstring 明講「不重用
     `InsufficientBaselineDataError`」)。幫它們追加一個共用 base class 等於
     回頭修改三個已定稿、互相獨立設計的既有類別,且會觸碰到本 ticket 範圍外
     明確排除的 `baseline.py`(「不變更 baseline.py 本身的門檻邏輯」——雖然改
     base class 不是改門檻邏輯,但仍是在範圍外的檔案做非必要變更)。
   - Tuple-of-types 做法則完全不需要修改 `bff/baseline.py` /
     `bff/anomaly_tool_retry_loop.py` / `bff/anomaly_model_switch.py` 這三個
     檔案,所有變更侷限在本 bug 實際所在的 `bff/api/anomalies.py`,與
     ticket 範圍(「只修 anomalies.py 的例外分類邏輯」)精確對齊,風險面最小。
   - 代價:未來若再新增第 4 個「資料不足」例外類別,需要手動把它加進對應的
     tuple(已在程式碼註解中提醒),不是自動被一個 base class 涵蓋。這個代價
     在目前只有 3 個既有類別、且各自堅持獨立性的狀況下,小於回頭改 3 個既有
     檔案的風險與範圍外變更。

2. **在 `_run_target_date_rule` 內,同時 catch `InsufficientBaselineDataError`
   與 `MissingErrorRateDataError`(即使呼叫者可能是 night_batch_burst,它不會
   拋出這兩者)。**
   - `_run_target_date_rule` 是 tool_retry_loop / context_bloat /
     night_batch_burst 三種 anomaly_type 共用的同一份呼叫邏輯,函式本身不知道
     (也不需要知道)目前跑的是哪一種規則。讓它統一 catch 這兩種「資料不足」
     訊號,比在呼叫端按 anomaly_type 分流更簡單,且對 night_batch_burst 完全
     無副作用(它的 `detect_night_batch_burst` 不會拋出這兩種例外,這兩個
     except 分支對它來說永遠不會被觸發)。

3. **catch 的順序:先 catch 「資料不足」tuple(回傳 `[]`),再 catch 其餘
   `Exception`(回傳 `status="error"` 列)。**
   - 三個「資料不足」例外類別全部繼承 `ValueError`,而 AC6 既有回歸測試用一般
     `ValueError("boom: ...")` 模擬「規則引擎真正壞掉」,預期仍要出現
     `status="error"` 列。因此必須用具體子類別(而非 `except ValueError`)
     才能把這兩種情境分開——這正是 tuple-of-types 設計要解決的核心問題。

4. **「資料不足」情境下回傳 `[]`,完全不產生列(連 `status="ok"` 的列也不產生)。**
   - 與 AC2(not anomalous → 不產生列)用的是同一個「無列」語意,對前端
     `anomaly-error-banner.tsx` 完全透明——它本來就只渲染 `anomalies[]`
     陣列裡實際存在的列,所以前端不需要任何改動,與 ticket 範圍「不修改前端」
     一致。

## UI 原型

無,本 Story 不涉及前端 UI 變更——這是純後端 bug fix(`bff/api/anomalies.py`
例外分類邏輯),需求規格已明確核實
`frontend/components/anomalies/anomaly-error-banner.tsx` 行為正確、無需修改,
範圍外也明文排除修改前端。

## 實作要點(供 developer 參考,非規格新增)

`bff/api/anomalies.py` 需新增 import:

```python
from anomaly_model_switch import InsufficientSwitchWindowDataError  # + 既有 import
from anomaly_tool_retry_loop import MissingErrorRateDataError  # + 既有 import
from baseline import InsufficientBaselineDataError
```

新增一個模組層級常數,讓「哪些例外屬於資料不足」有單一事實來源:

```python
# AC1/AC2/AC3: these two exception classes are the deliberate "cannot
# compute, not a rule-engine failure" signal (see docs/design/SDLCCT-69.md
# decision #1) for the 3 target_date rules (tool_retry_loop raises both;
# context_bloat raises only InsufficientBaselineDataError via
# compare_to_baseline(); night_batch_burst raises neither, so these
# branches are simply never hit for it).
_NORMAL_RULE_NO_DATA_ERRORS = (InsufficientBaselineDataError, MissingErrorRateDataError)
```

`_run_target_date_rule` 的 try/except 區塊改為:

```python
try:
    finding = detect_fn(key, target_date=target_date, interval_start=interval_start, interval_end=interval_end)
except _NORMAL_RULE_NO_DATA_ERRORS:
    return []  # AC1/AC2/AC3: insufficient data -> treat as "no anomaly", not an error row
except Exception as exc:  # noqa: BLE001 -- AC4: any OTHER rule exception still -> error row
    return [_row(agent=key, anomaly_type=anomaly_type, row_date=None, status="error", reason=str(exc))]
```

`_run_model_switch` 的 try/except 區塊改為:

```python
try:
    finding = detect_model_switch(key, interval_start=interval_start, interval_end=interval_end)
except InsufficientSwitchWindowDataError:
    return []  # AC3: insufficient switch-window data -> no row
except Exception as exc:  # noqa: BLE001 -- AC4
    return [_row(agent=key, anomaly_type="model_switch", row_date=None, status="error", reason=str(exc))]
```

`_run_governance_gaps` **不變**(無對應例外類別,AC5 範圍)。

模組 docstring 頂部應追加一句指向本設計文件,說明這次例外分類的理由,比照
現有 `See docs/design/SDLCCT-51.md ...` 的寫法。

## 測試新增(`bff/tests/test_api_anomalies.py`)

延續既有檔案的 monkeypatch 慣例(`_patch_all_no_findings` + 針對單一
`detect_*` 覆寫)。新增以下測試,對應 AC1-AC6:

1. `test_ac1_insufficient_baseline_data_in_tool_retry_loop_emits_no_row` ——
   monkeypatch `detect_tool_retry_loop` 對單一 agent 拋出
   `InsufficientBaselineDataError("...")`,斷言 `resp.status_code == 200`、
   回應中完全沒有該 agent 的 `tool_retry_loop` 列(無論 ok 或 error),且其他
   7 個 agent 不受影響。
2. `test_ac1_insufficient_baseline_data_in_context_bloat_emits_no_row` ——
   同上,改 monkeypatch `detect_context_bloat`。
3. `test_ac2_missing_error_rate_data_in_tool_retry_loop_emits_no_row` ——
   monkeypatch `detect_tool_retry_loop` 拋出
   `MissingErrorRateDataError("...")`,斷言無該列產生。
4. `test_ac3_insufficient_switch_window_data_emits_no_row` ——
   monkeypatch `detect_model_switch` 拋出
   `InsufficientSwitchWindowDataError("...")`,斷言無 `model_switch` 列產生
   (而非之前的「status=error」列)。
5. **AC4 regression(維持既有行為)**:既有的
   `test_ac6_rule_exception_emits_explicit_error_row_and_other_agents_continue`
   與 `test_ac6_model_switch_exception_emits_explicit_error_row` 兩個測試
   (皆用一般 `ValueError` 模擬)**不修改,必須原樣繼續通過**——這是驗證
   tuple-of-types 設計沒有把「普通例外」誤判為「資料不足」的回歸測試。
6. **AC5 regression**:既有
   `test_ac6_governance_gap_batch_failure_emits_error_row_with_null_agent`
   不修改,必須原樣繼續通過(`find_governance_gaps` 批次失敗行為不變)。
7. 新增 import:於測試檔案頂部補上
   `from anomaly_model_switch import InsufficientSwitchWindowDataError`、
   `from anomaly_tool_retry_loop import MissingErrorRateDataError`、
   `from baseline import InsufficientBaselineDataError`。

Developer 實作時應確認:新增測試中,被 monkeypatch 的 `detect_fn` 對其餘
7-8 個 agent 仍回傳 `_not_anomalous_*`(沿用 `_patch_all_no_findings`),以
維持「只有被注入例外的那個 agent 受影響」的既有測試風格。

## 開放設計問題(定稿時必須為空)

無。
