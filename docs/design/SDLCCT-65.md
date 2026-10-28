# 設計文件 — SDLCCT-65 異常原因文字改寫為業務語言，避免直接顯示規則引擎的內部除錯字串

## 對應需求規格
SDLCCT-65（G1 通過版本）。範圍已由 requirements-analyst 核實：僅改寫
`bff/api/anomalies.py` 中 5 個 `_xxx_reason()` 函式的回傳字串內容，改為固定中文
業務語言模板；不改規則判斷邏輯（`bff/anomaly_*.py`）、不改 API 契約（`reason`
仍是字串欄位）、不改前端 `anomaly-table.tsx`。6 個 Gherkin scenario（model_switch /
governance_gap / context_bloat / tool_retry_loop / night_batch_burst 有
workflow / night_batch_burst 無 workflow）已在票面給出逐字輸出範例，本設計逐一對照
現有程式碼確認可行並給出確切實作。

## 介面/API 契約
無變更。`GET /api/anomalies` 回應結構維持
`{"anchor_date": str, "anomalies": [{"agent", "anomaly_type", "date", "status", "reason"}]}`
不變；`reason` 仍是純字串欄位，只是內容從目前的除錯字串（如
`error_rate=0.25 (threshold=0.01), spans/trace deviation_ratio=3.0 (...)`）
改為下方「關鍵技術決策」逐一列出的業務語言模板字串。`status="error"` 列的
`reason`（`str(exc)`，來自 `_run_target_date_rule`/`_run_model_switch`/
`_run_governance_gaps` 的 `except Exception` 分支）維持不變，不在本票範圍內。

## 資料模型
無新增資料模型。以下為 5 個 `_xxx_reason(finding)` 實際讀取的既有 Finding
dataclass 欄位（供 developer 對照，確認與票面 Gherkin 範例假設的欄位名稱一致）：

- `ModelSwitchFinding`（`bff/anomaly_model_switch.py`）：
  `switch_date: date`, `before_model_tag: str`（形如 `"model:gpt-4o-mini"`，
  帶 `MODEL_TAG_PREFIX = "model:"` 前綴）, `after_model_tag: str`（同前綴格式）,
  `deviation_ratio: float`。
- `GovernanceGapFinding`（`bff/anomaly_governance_gap.py`）：
  `registered: bool`, `owner: str | None`, `budget: float | None`,
  `first_day_cost: float | None`, `last_day_cost: float | None`。
- `ContextBloatFinding`（`bff/anomaly_context_bloat.py`）：
  `comparison: BaselineComparison`，其中
  `baseline_window_days: int`（=21）, `baseline_value: float`,
  `actual_value: float`, `deviation_pct: float`（已是 `(ratio-1)*100`）。
- `ToolRetryLoopFinding`（`bff/anomaly_tool_retry_loop.py`）：
  `error_rate: float`（0~1 之間的小數）, `comparison: BaselineComparison`
  （`deviation_ratio`, `baseline_value`, `actual_value`，單位為「平均每筆對話
  呼叫工具次數」）。
- `NightBatchBurstFinding`（`bff/anomaly_night_batch_burst.py`）：
  `off_hours_window_utc: tuple[int, int]`（=`(17, 19)`）, `ratio: float`,
  `corroborating_workflow: str | None`。

全部欄位名稱與型別均與票面 Gherkin 範例的假設一致，無落差。

## 關鍵技術決策

1. **固定 f-string 模板，不做條件式子句（除 night_batch_burst 的 workflow 外）**
   ——5 個函式都改成單一固定中文模板，不依 Finding 的哪個子欄位觸發而換字句
   （例如 governance_gap 不管是 `registered=False` 還是單純 `owner is None`
   都輸出同一句「此 Agent 尚未登錄負責人與預算」）。理由：票面範圍確認明確
   寫「固定模板字串」，且 Gherkin 只給了一種輸出模板，没有要求按觸發條件分支。

2. **`_model_switch_reason`**：
   ```python
   def _model_switch_reason(finding: Any) -> str:
       before = finding.before_model_tag.removeprefix(MODEL_TAG_PREFIX)
       after = finding.after_model_tag.removeprefix(MODEL_TAG_PREFIX)
       ratio = round(finding.deviation_ratio)
       return (
           f"模型於 {finding.switch_date.month}/{finding.switch_date.day} "
           f"由 {before} 切換為 {after}，成本偏離正常值約 {ratio} 倍"
       )
   ```
   需在檔案頂部新增 `from anomaly_model_switch import MODEL_TAG_PREFIX`（既有
   import 已從同模組 import `InsufficientSwitchWindowDataError, detect_model_switch`，
   順手加入同一行）——理由：`before_model_tag`/`after_model_tag` 帶
   `"model:"` 前綴，若直接用 `.removeprefix("model:")` 硬編碼字串會跟
   `MODEL_TAG_PREFIX` 常數脱鉑（未來若常數改變，這裡會悄悄跟著錯），改引用常數
   比重複硬編碼字面值更安全。
   日期格式 `{month}/{day}`（無前導零，如 `10/6`）直接對應票面範例；
   `deviation_ratio` 用 `round()` 四捨五入成整數倍數（範例 `21`、`5` 皆為整數）。

3. **`_governance_gap_reason`**：
   ```python
   def _governance_gap_reason(finding: Any) -> str:
       cost = finding.last_day_cost
       amount = _format_usd(cost) if cost is not None else "未知"
       return f"此 Agent 尚未登錄負責人與預算，過去一日花費約 {amount}"
   ```
   用 `last_day_cost`（視窗內最後一天，即最接近 anchor_date 的花費）而非
   `first_day_cost`——理由：「過去一日花費」語意上指「最近一天」，
   `last_day_cost` 的欄位命名本身就是「視窗最後一天 = 最近一天」，與
   `first_day_cost`（視窗起點，約 22 天前）語意不符。
   `last_day_cost is None` 時顯示「未知」而非 0 或空白——依
   `CONSTITUTION.md`「失敗處理」原則：「a missing field yields a null cost,
   which must be shown as unknown, never as 0」，此處直接套用同一原則於
   reason 字串內的金額顯示。

4. **`_format_usd` 新增小工具函式**（`bff/api/anomalies.py` 內部，不對外匯出）：
   ```python
   def _format_usd(value: float) -> str:
       return f"US$ {round(value):,}"
   ```
   不重用前端 `frontend/lib/format.ts` 的 `formatCurrency`——理由：
   那是 TypeScript，執行在瀏覽器端，bff（Python）無法呼叫；且
   `docs/design/SDLCCT-32.md`已定案「時區換算在前端/展示層」的分層原則，
   同理「金額千分位顯示」這類純展示格式化本可留給前端，但這裡的金額是嵌在
   一句完整中文描述句子中間（而非獨立數值欄位），無法交給前端二次格式化，
   所以 bff 側需要自己一個極簡的千分位格式化，不嘗試完整複製前端的
   「小數點兩位 fallback」邊界規則（那是給獨立金額欄位用的；這裡的金額都是
   日花費量級的整數即可，`round()` 後直接千分位即滿足票面範例
   `US$ 36`）。若未來金額可能小於 1（如 `US$ 0.4`），需要另外處理，但現有
   Demo 資料與票面範例都是兩位數以上整數金額，暫不過度設計（Scope discipline）。

5. **`_context_bloat_reason`**：
   ```python
   def _context_bloat_reason(finding: Any) -> str:
       c = finding.comparison
       pct = round(c.deviation_pct)
       return (
           "此 Agent 近期每筆對話的 prompt token 使用量較過去 "
           f"{c.baseline_window_days} 天基準值高出約 {pct}%"
           f"（目前約 {round(c.actual_value)}、基準約 {round(c.baseline_value)} tokens/trace）"
       )
   ```
   用 `comparison.deviation_pct`（已經是 `(ratio-1)*100`，由
   `bff/baseline.py` 算好）而非自己用 `deviation_ratio` 重算百分比——理由：
   避免同一個百分比數字在兩處用不同公式算出兩個稍有差異的值；
   `deviation_pct` 本來就是為了「解釋給人看」而存在的欄位（dataclass 註解
   "explain-your-reasoning"），直接讀取即可。tokens/trace 數值量級通常是
   幾十到幾百，四捨五入到整數（`round()`，不留小數）符合票面範例
   `160`/`120`。

6. **`_tool_retry_loop_reason`**：
   ```python
   def _tool_retry_loop_reason(finding: Any) -> str:
       c = finding.comparison
       error_pct = round(finding.error_rate * 100)
       ratio = round(c.deviation_ratio)
       return (
           "此 Agent 近期錯誤率與平均工具呼叫次數同時異常升高："
           f"錯誤率約 {error_pct}%，"
           f"平均每筆對話呼叫工具次數較基準值高出約 {ratio} 倍"
           f"（目前約 {c.actual_value:.1f}、基準約 {c.baseline_value:.1f} 次/trace）"
       )
   ```
   `error_rate` 是 0~1 小數（如 `0.25`），乘 100 四捨五入成整數百分比
   （範例 `25%`）。`c.actual_value`/`c.baseline_value`（平均每筆對話呼叫工具
   次數）用 `:.1f` 固定一位小數，而非 `round()` 到整數——理由：這個量級
   通常是個位數（如 `6.0`、`2.0`），票面範例明確寫出 `.0`，用 `:.1f` 保證
   永遠顯示一位小數，不會因為剛好整數而被 Python 的 `str(round(x))` 吃掉
   小數點（`round(6.0)` 會變成 `int 6`，印出 `"6"` 而非 `"6.0"`，
   與範例不符）；`round(x, 1)` 也有同樣風險（`round(6.0, 1)` 是
   `float 6.0`，`str()` 恰好印 `"6.0"`，但保留 `:.1f` 格式化比依賴這個
   巧合更明確、更不怕未來數值剛好踩到整數邊界）。"較基準值高出約 X 倍"
   直接用 `deviation_ratio`（不是 `ratio - 1`）——跟 night_batch_burst 的
   "約為...的 42 倍" 用法一致，均為「是基準值的幾倍」而非「超出基準值的
   幾倍」，對應票面範例 `6.0/2.0=3.0` → `"約 3 倍"`。

7. **`_night_batch_burst_reason`**：
   ```python
   def _night_batch_burst_reason(finding: Any) -> str:
       start_hour, end_hour = finding.off_hours_window_utc
       ratio = round(finding.ratio)
       base = (
           f"此 Agent 於非營業時段（UTC {start_hour:02d}:00–{end_hour:02d}:00）"
           f"出現異常大量請求，約為平時同時段的 {ratio} 倍"
       )
       if finding.corroborating_workflow:
           base += f"，可能與批次工作流程「{finding.corroborating_workflow}」相關"
       return base
   ```
   `corroborating_workflow is None`（或空字串，`if finding.corroborating_workflow`
   用真值判斷一併擋掉空字串，雖然 `_highest_workflow()` 實際只會回傳
   `None` 或非空字串）時完全省略「可能與...相關」子句，對應票面第 6 個
   scenario（無 workflow 邊界案例）——這是票面唯一明確要求的條件式片段，
   其餘 4 個函式都是固定整句模板。`off_hours_window_utc` 用
   `:02d` 補零成 `17:00`/`19:00`，對應範例 `UTC 17:00–19:00`。

8. **四捨五入一律用 Python 內建 `round()`/`:.1f` 格式化，不自訂無穿越性的
   顯示規則**——這些 reason 字串只用於人類閱讀的異常說明，不是計算用途，
   `round()` 的 banker's rounding 邊界差異（例如 `round(2.5)==2`）在這個
   情境下不構成資料正確性問題（CONSTITUTION「資料正確性」原則針對的是畫面
   上可追溯的數字來源，而這裡的四捨五入後數字本身仍可從 Finding 的原始
   `deviation_ratio`/`actual_value` 等欄位回溯，只是顯示時少了小數位），
   不需要額外設計四捨五入演算法。

## UI 原型
無，本 Story 不涉及前端 UI——範圍確認已明定「前端 `anomaly-table.tsx`
皆不變」，只是其渲染的 `reason` 字串內容改變，排版/樣式/元件結構完全不動，
沒有新增或調整的畫面需要原型驗證。

## 現狀測試盤點（供 developer 同步更新）
`bff/tests/test_api_anomalies.py` 中以下既有斷言直接檢查目前的除錯字串格式，
新模板上線後會失敗，需要同步改寫斷言內容（不改測試案例的意圖/覆蓋範圍，只改
字串斷言本身）：

- L163 `assert "2.0" in row["reason"]`（context_bloat，AC1）——新模板仍會輸出
  `round(actual_value)`/`round(baseline_value)`，但不再是 `"2.0"`
  （`actual_value=200.0, baseline_value=100.0` → 新字串含 `"200"`、`"100"`，
  不含 `"2.0"`），需改成檢查新模板的實際輸出片段。
- L196-198（model_switch，AC3）：
  `assert "model:gpt-cheap" in row["reason"]`、
  `assert "model:gpt-expensive" in row["reason"]`——新模板會 strip 掉
  `"model:"` 前綴，變成 `"gpt-cheap"`/`"gpt-expensive"`，斷言字串需去掉前綴。
  `assert "5.0" in row["reason"]`——新模板 `round(5.0)` 印出 `"5"`，需改成
  檢查 `"5"` 或 `"約 5 倍"`。
- L234 `assert "registered=False" in row["reason"]`（governance_gap，AC5）
  ——新模板完全不輸出 `registered=` 這種欄位傾印，需改成檢查新句子的固定
  字樣（如 `"尚未登錄負責人與預算"`）。
- L257 `assert row["reason"] == "boom: no usable baseline data"`
  （AC6，`status="error"` 列）——此斷言對應 `str(exc)`，本票不改
  `status="error"` 的 reason 產生方式，此斷言**不需改動**，列出僅供
  developer 確認不要誤改。
- L283 同上（`status="error"`，governance_gap 批次失敗），**不需改動**。
- L325-326（tool_retry_loop，AC1）：
  `assert "error_rate=0.25" in row["reason"]`、
  `assert "3.0" in row["reason"]`——新模板輸出「錯誤率約 25%」與「約 3 倍」，
  不再有 `error_rate=` 字樣，斷言需全面改寫。
- L361-362（night_batch_burst，AC1）：
  `assert "off_hours_trace_count=42" in row["reason"]`——新模板不輸出
  `off_hours_trace_count=`，但仍會輸出 `"nightly_sync"`（L362 斷言不變）
  與基於 `ratio=42.0` 算出的 `"42"`（新模板的「約為平時同時段的 42 倍」），
  需改寫 L361。
- L388 同 L257/L283 性質（AC6，`status="error"`），**不需改動**。
- L423-427（AC5 第二個測試，`test_ac5_governance_gap_reason_includes_owner_budget_and_cost_fields`）：
  `owner='team-ops'`、`budget=500.0`、`first_day_cost=10.0`、
  `last_day_cost=20.0`、`registered=True` 五個斷言全部對應舊除錯字串的欄位
  傾印，新固定模板完全不輸出這些欄位值（只固定輸出「尚未登錄負責人與預算，
  過去一日花費約 US$ 20」），這個測試案例的「驗證 owner/budget/cost 都真的
  出現在 reason 裡」的原始意圖在新模板下不再適用（新模板是固定句子，不逐欄位
  echo），developer 需要連同測試案例的用意一起重新评估，不是單純換斷言字串
  ——例如改成斷言新固定句子 + `last_day_cost` 算出的金額（`"US$ 20"`）。

未發現任何跨元素樣式一致性測試（`toEqual`/"一致" 等 computed-style 比對）
涉及本次變更的選擇器——本票為純 bff 字串變更，不涉及任何前端 CSS/樣式，第 4
步驟的檢查項不適用。

## 開放設計問題(定稿時必須為空)
無。所有票面 Gherkin 範例引用的 Finding 欄位名稱/型別均已對照原始碼確認存在且
一致；金額來源欄位（`last_day_cost` vs `first_day_cost`）、金額格式化方式、
缺值顯示（「未知」）均可由 CONSTITUTION.md 既有原則與欄位命名語意直接推導，
不構成規格未講清楚的產品決策。
