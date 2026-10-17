# 設計文件 — SDLCCT-12 Agent registry store

## 對應需求規格
對應 G1 已核准的需求規格「Agent registry store」。範圍：提供一份以
`seed/catalog.py` 的 `AGENTS` 為唯一事實來源、可查詢的 Agent registry，
涵蓋全部 9 個 Agent 的 `key`/`display`/`dept`/`dept_code`/`owner`/
`budget`/`registered` 六個欄位，並能正確區分出「有花費但未登錄」的治理
缺口案例（`temp_supplier_scraper`）。registry 的種子資料須由 `catalog.py`
匯出而非手動重複維護。範圍外：異常偵測/比對邏輯（E4）、預算超支告警、
劇本內容變更、治理查詢以外的模擬資料欄位；寫入介面是否實作由本文件
決定（見「關鍵技術決策」）。

## 介面/API 契約
本 Story 不新增對外 HTTP 介面——project-profile.yaml 的 Portal/BFF 技術棧
仍待定（gated on SDLCCT-10 G1b，目前 BLOCKED），本設計刻意不去預測
未來 BFF 的語言，而是把 registry 做成與語言無關的純 Python 模組 + JSON
匯出檔，任何語言的 BFF 之後都能直接讀 JSON 檔，不需等這個決定。

- **新增模組：`seed/registry.py`**（與 `seed/generate.py`、`seed/verify.py`
  同層，沿用既有目錄慣例，`import` 風格與 `seed/tests/test_generate_
  determinism.py` 的 `from catalog import SCALE` 一致）。
- **讀取 API（供未來 Python 端或本模組自身測試使用）：**
  - `load_registry() -> tuple[dict, ...]`
    回傳 9 筆 dict，每筆恰好六個鍵，鍵名與型別逐一對應 Gherkin 原文：
    ```python
    {
        "key": str,
        "display": str,
        "dept": str,
        "dept_code": str,
        "owner": str | None,
        "budget": float | None,
        "registered": bool,
    }
    ```
    資料直接取自 `catalog.AGENTS` 的同名欄位（`Agent.budget` 對應
    `budget`，其餘欄位逐字對應），不重新命名、不新增衍生欄位。
  - `get_agent(key: str) -> dict | None`
    在 `load_registry()` 的結果中以 `key` 查找單筆記錄；查無則回傳
    `None`（讀取介面本身不對「查無此 key」拋例外，比對邏輯/404 轉換
    留給未來的 BFF 層決定，非本 Story 範圍）。
- **匯出 API（語言無關的輸出，供未來任何語言的 BFF 消費）：**
  - `export_registry() -> Path`：呼叫 `client.save("registry",
    list(load_registry()))`，寫出 `seed/out/registry.json`
    （沿用 `seed/client.py::save()` 現有的 `OUT_DIR = seed/out`、
    `json.dumps(..., indent=2, ensure_ascii=False, default=str)` 慣例，
    與 `generate.py` 的 `manifest.json`/`manifest_dryrun.json` 同一套
    I/O 機制，不另起一套）。`seed/out/` 已在 `.gitignore` 排除，匯出檔
    不進版控，與既有 manifest 檔案一致。
  - CLI 入口：`uv run python registry.py`（在 `seed/` 目錄下執行，比照
    `generate.py main()` 的 `argparse` + `sys.exit(main())` 風格），
    執行後印出寫入路徑並回傳 0。
- **JSON 匯出檔格式**（`seed/out/registry.json`）：
  ```json
  [
    {"key": "maintenance_copilot", "display": "設備維修助理", "dept": "設備部",
     "dept_code": "eq", "owner": "王志明", "budget": 900, "registered": true},
    ...
    {"key": "temp_supplier_scraper", "display": "臨時供應商爬蟲", "dept": "未登錄",
     "dept_code": "none", "owner": null, "budget": null, "registered": false}
  ]
  ```
  陣列，依 `catalog.AGENTS` 的既有順序，9 筆，每筆六欄。

## 資料模型
無新增持久化資料表/索引——registry 不是一個資料庫，而是「`catalog.AGENTS`
的唯讀投影」。新增的唯一資料載體是上述匯出檔
`seed/out/registry.json`（衍生產物，可任意重新產生，不是事實來源）。
`catalog.py` 的 `Agent` dataclass 本身不變動（SDLCCT-7 已定案的欄位
`key`/`display`/`dept`/`dept_code`/`owner`/`budget`/`registered` 已完整
具備，`generate.py` 現有的 `manifest["registry"]` 也已從同一來源投影出
幾乎相同的清單，但鍵名不同——`project` 而非 `key`、`budget_usd` 而非
`budget`，且額外夾帶 `cost_center`——因此本 Story 不直接重用
`manifest["registry"]`，改由 `registry.py` 直接讀 `AGENTS` 做欄位對齊，
理由見下）。

## 關鍵技術決策

- **新增獨立的 `seed/registry.py`，不直接重用 `generate.py` 既有的
  `manifest["registry"]`**——理由兩個:(1) 欄位名不同，`generate.py`
  的 `registry` 項目用的是 `project`/`budget_usd`，而本 Story 的 Gherkin
  明文要求欄位名為 `key`/`budget`，若硬要重用需要在消費端重新 map,
  不如在來源端一次對齊;(2) `generate.generate()` 是重量級函式——呼叫它
  會連帶跑 `load_prices(MODELS)`（讀取價格快照檔）、產生 30 天全部
  traces/spans 等與 registry 完全無關的計算，只為了拿 9 筆 registry
  記錄而觸發這些屬於 E1/E2 範疇的運算，是不必要的耦合，也會讓本故事
  的測試被迫依賴與 registry 無關的程式碼路徑。獨立模組只依賴
  `catalog.AGENTS`，依賴面最小。
- **匯出格式選 JSON 檔（`seed/out/registry.json`），不選 SQLite/CSV
  或直接嵌入程式碼常數**——對應限制段「若 BFF 技術棧非 Python，需要一個
  單向匯出步驟」：JSON 是現有 `manifest.json`/`manifest_dryrun.json`
  已採用、且幾乎所有語言生態都原生支援的格式，不需為尚未決定的 BFF
  語言多做假設；沿用 `client.save()` 既有機制，不新增第二套序列化
  慣例。
- **單向匯出：`registry.py` 只能從 `catalog.py` 產生 JSON，JSON 永遠
  不回寫 `catalog.py`**——對應限制段「絕不可讓兩份清單各自獨立維護」。
  `catalog.AGENTS` 是程式碼常數，`seed/out/registry.json` 是其唯讀投影；
  未來若要修改某個 Agent 的 `owner`/`budget` 等欄位，動作永遠是編輯
  `catalog.py` 後重新執行匯出，而不是手動編輯 JSON 檔。
- **本 Story 不提供寫入/更新 registry 的介面（`export_registry()`
  是唯一的輸出動作，沒有對應的 `update_agent()`/CLI `--set` 等）**——
  spec 的「範圍外」段明文把「寫入介面是否實作」留給本文件決定。
  決定不做的理由：(1) Gherkin 三個情境全部是讀取/比對語意（讀取全部、
  查詢單筆、匯出比對），沒有一條要求「修改既有資料」；(2) 唯一事實
  來源是 `catalog.py` 原始碼，Agent 的 owner/budget/registered 等欄位
  本質是「寫 code review 變更程式碼」的治理資料，不是執行期可變狀態，
  提供一個繞過 code review 直接改 registry 的寫入 API 反而違背「唯一
  事實來源」的限制；(3) 若之後 E3/E4 需要「人工標記已登錄」這類執行期
  寫入語意，那是新的產品決策（例如：寫入要落到哪裡、要不要回寫
  `catalog.py`），超出本 Story 已核准範圍，應該是未來獨立 Story，而非
  現在順手加上去。
- **`get_agent()` 查無資料回傳 `None` 而非拋例外**——沿用本程式碼庫
  既有風格（例如 `client.project_ids()` 查無專案時回傳空 dict 而非
  拋錯),把「key 不存在該如何回應」的 API 層語意（404？null？）留給
  未來實際消費這個模組的 BFF 決定，本模組只負責提供最小可組合的查詢
  原語。
- **匯出檔與 `AGENTS` 的一致性驗證：`seed/tests/` 新增的測試直接比對
  `load_registry()` 輸出與 `catalog.AGENTS` 逐欄相等（非本文件新增測試
  範圍，留給 developer 依 Gherkin Scenario 3 實作），不額外設計一套
  獨立的 schema 校驗機制**——`load_registry()` 本身就是從 `AGENTS` 計算
  出來的純函式，兩者不可能漂移，所謂「一致性」驗證即是「函式回傳值
  等於對 `AGENTS` 做同樣轉換後的預期值」，不需要額外機制。

## UI 原型
無，本 Story 不涉及前端 UI——這是 `seed/` 底下的純 Python 後端模組與 JSON
匯出，Portal 畫面（E3 Agent 清冊）尚未存在、且該畫面的技術棧仍待定
（project-profile.yaml 標示 TBD，gated on SDLCCT-10），不在本 Story
範圍內。

## 開放設計問題(定稿時必須為空)
（無）
