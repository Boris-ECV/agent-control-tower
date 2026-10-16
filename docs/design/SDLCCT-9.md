# 設計文件 — SDLCCT-9 Demo anchor date configuration

## 對應需求規格
對應 G1 已核准的需求規格「Demo anchor date configuration」。範圍：提供一個
`seed/` 下可被 Python 程式碼讀取、有清楚文件記載的「演示錨點日」設定值
（含預設值 2026-10-15 與環境變數覆寫機制 `DEMO_ANCHOR_DATE`），回傳值為
帶 UTC tzinfo、當天 00:00:00 的 datetime，供下一張 Story（Opik 客戶端）及
任何時間窗查詢邏輯使用同一個穩定的「今天」基準。範圍外（已於 G1 核准,
不可擴大）：畫面 UI、顯示時區轉換、BFF 技術選型（延至 SDLCCT-10）；
`seed/generate.py` 現有 CLI `--anchor` 的預設邏輯本身（人類已明確決定維持
現狀，本 Story 嚴禁改動）。

## 介面/API 契約
本 Story 不新增對外 HTTP 介面。契約是「一個環境變數 + 一份固定的解析/
預設規則」，刻意不綁定 Python 執行期本身——未來若 BFF 改用非 Python 語言
實作，只要該語言的程式碼讀同一個環境變數 `DEMO_ANCHOR_DATE`、套用同一套
「未設定時用 2026-10-15、設定時以 ISO 日期字串解析為 UTC 00:00:00、格式
不合法時報錯」規則，就能讀到與本模組相同的值——不需要額外的語言無關
匯出檔（不同於 SDLCCT-12 的 registry，這裡沒有需要預先計算的資料，只有
一條規則，任何語言都能直接重新實作同一條規則，不需要本模組計算好的
產物）。

- **新增模組：`seed/anchor.py`**（與 `seed/generate.py`、`seed/client.py`、
  `seed/registry.py` 同層，獨立於 `generate.py` 既有的 `--anchor` CLI
  解析邏輯——兩者不互相呼叫、不共用函式，`generate.py` 本身不變動）。

  ```python
  """Demo anchor-date configuration: a single stable 'today' for all
  seed/ time-window queries (SDLCCT-9).
  """

  import os
  from datetime import UTC, date, datetime

  ANCHOR_ENV_VAR = "DEMO_ANCHOR_DATE"

  # Human-confirmed demo anchor (2026-10-15). Fixed literal — never derive
  # this from datetime.now() or any other computation.
  DEFAULT_ANCHOR_DATE: date = date(2026, 10, 15)


  class InvalidAnchorDateError(ValueError):
      """Raised when DEMO_ANCHOR_DATE is set but is not a valid ISO date
      string (e.g. "not-a-date"). Never silently falls back to the default.
      """


  def get_anchor_date() -> datetime:
      """Return the demo anchor date as a UTC-aware datetime at 00:00:00.

      - DEMO_ANCHOR_DATE unset or empty -> DEFAULT_ANCHOR_DATE.
      - DEMO_ANCHOR_DATE set to a valid ISO date string (YYYY-MM-DD) ->
        that date, at 00:00:00 UTC.
      - DEMO_ANCHOR_DATE set to anything else -> InvalidAnchorDateError.
      """
      raw = os.environ.get(ANCHOR_ENV_VAR, "").strip()
      d = DEFAULT_ANCHOR_DATE
      if raw:
          try:
              d = date.fromisoformat(raw)
          except ValueError as exc:
              raise InvalidAnchorDateError(
                  f"{ANCHOR_ENV_VAR}={raw!r} is not a valid ISO date (YYYY-MM-DD)"
              ) from exc
      return datetime.combine(d, datetime.min.time(), tzinfo=UTC)
  ```

  - 函式簽名：`get_anchor_date() -> datetime`，回傳值一律是帶
    `tzinfo=UTC`（`datetime.UTC`）的 `datetime`，時間部分恆為
    `00:00:00.000000`，對應 AC1。
  - 環境變數名稱固定為 `DEMO_ANCHOR_DATE`（模組常數 `ANCHOR_ENV_VAR`，
    供測試與未來文件引用，不直接寫字串字面值）。
  - 未設定或空字串 → `DEFAULT_ANCHOR_DATE`（2026-10-15），對應 AC2。
  - 設定為合法 ISO 日期字串（如 `"2026-10-15"`）→ 解析為該日期的 UTC
    00:00:00，對應 AC3。
  - 設定為無法解析字串（如 `"not-a-date"`）→ 拋出
    `InvalidAnchorDateError`（`ValueError` 子類別），不吞例外、不回退
    預設值、不回傳 `None`，對應 AC4。

## 資料模型
無新增資料模型——本 Story 只新增一個純函式模組，沒有資料表、索引或
持久化欄位。`seed/catalog.py` 的既有結構不變動。

## 關鍵技術決策

- **獨立新增 `seed/anchor.py`，不碰、不重用 `generate.py` 現有的
  `--anchor` CLI 解析邏輯**——對應限制段「嚴禁改動 `generate.py` 的 CLI
  預設行為」。`generate.py::main()` 的 `args.anchor` 分支（未帶
  `--anchor` 時用 `datetime.now(UTC)` 取「執行當下」，而非本 Story 的
  固定 2026-10-15 預設）是刻意保留的既有行為,語意與本 Story 的「演示
  錨點日」完全不同，兩者刻意不共用函式，避免往回修改 `generate.py` 的
  風險，也避免未來誤以為兩者是同一套規則。
- **只接受 `date.fromisoformat`（`YYYY-MM-DD`）而非
  `datetime.fromisoformat`（允許帶時間/時區的完整 ISO 字串）**——spec
  的 AC3 範例只示範 `"2026-10-15"` 這種純日期字串；限定輸入格式為純日期
  讓「合法」與「不合法」的邊界單一、明確，不需要額外決定「使用者若帶
  時間部分該怎麼處理」這個 spec 沒問過的問題。
- **拋出自訂例外 `InvalidAnchorDateError(ValueError)`，而非直接讓
  `date.fromisoformat` 的原生 `ValueError` 外洩、也不是 `client.py::
  base_url()` 風格的 `SystemExit`**——理由兩個:(1) AC4 要求「明確報
  錯」，自訂子類別讓呼叫端可以精確 `except InvalidAnchorDateError`
  區分「設定了但格式錯」與其他 `ValueError`，訊息內容也能直接帶出
  env var 名稱與原始值，比原生例外訊息更明確;(2) 用 `ValueError` 而非
  `SystemExit`——`client.py::base_url()` 的 `SystemExit` 是針對「必填且
  無預設值」的 CLI 情境，而 `get_anchor_date()` 未設定時有明確預設值
  （AC2），只有「設定了但解析失敗」才是錯誤，語意上更接近程式庫函式的
  輸入驗證錯誤，用 `ValueError` 家族讓一般 Python 呼叫端（含未來的測試
  與下一張 Story 的客戶端程式碼）可以用標準方式 `except ValueError`
  攔截。
- **每次呼叫即時讀取 `os.environ`，不在模組載入時快取**——沿用
  `client.py::base_url()` 既有慣例（同樣是每次呼叫才讀 env var），讓
  測試可以用 `monkeypatch.setenv`/`delenv` 在同一個 process 內針對不同
  測試案例切換環境變數值，不需要重新 import 模組。
- **`DEFAULT_ANCHOR_DATE` 存成模組層級的 `date` 常數字面值
  `date(2026, 10, 15)`，並以註解標明「人類已確認、固定值、不可由其他
  運算推導」**——對應 AC2 要求「這是人類已確認的固定預設值，不可用
  其他值」；存成字面值常數而非運算結果（例如不是 `date.today()` 或某個
  offset），讓這個值在 code review 中一看即明、可直接 diff 比對，未來
  若人類決定變更錨點日,只需改這一行常數。
- **回傳值用 `datetime.combine(d, datetime.min.time(), tzinfo=UTC)` 組出
  UTC 00:00:00，不用 `d.astimezone(UTC)` 或其他轉換方式**——
  `date` 物件本身没有時區概念，`combine` + 明確指定
  `tzinfo=UTC` 是唯一不經過「先假設某個時區再轉換」就能直接得到「UTC
  午夜」的寫法，避免執行環境的系統時區意外介入,呼應
  project-profile.yaml 「Dates and daily buckets are UTC」的既有慣例。
- **本 Story 不修改 `seed/generate.py`、`seed/catalog.py`**——確認兩者
  現有結構與行為維持不變，`seed/anchor.py` 是純新增、獨立模組,與
  SDLCCT-12 新增 `seed/registry.py` 時採用的模式一致（新模組只依賴
  `catalog.py`/標準庫,不反向修改既有檔案）。

## UI 原型
無，本 Story 不涉及前端 UI——這是 `seed/` 底下的純 Python 設定值讀取
函式，沒有畫面或顯示時區轉換（兩者都已於 G1 列為範圍外）。

## 開放設計問題(定稿時必須為空)
（無）
