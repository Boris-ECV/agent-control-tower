# 設計文件 — SDLCCT-23 Guard seed generator writes against existing-data overwrite

## 對應需求規格
對應 G1 已核准的需求規格:為 `seed/generate.py::main()` 既有的「已存在資料拒
絕覆寫、`--force` 可明確繞過」防護邏輯（落實 CONSTITUTION.md「寫入操作在
目標已有資料時必須拒絕執行，除非呼叫者明確帶上強制旗標」原則）補上自動化
測試覆蓋，涵蓋全部 4 條 Gherkin AC:
1. 無 `--write`:只落 dry-run manifest,`client.api`/`client.project_ids`/
   `ingest.post_all` 皆未被呼叫。
2. 有既存 project、未帶 `--force`:回傳碼 2,`ingest.post_all` 未被呼叫。
3. 有既存 project、帶 `--force`:回傳碼 0,`post_all` 對 traces/spans 各呼叫
   一次。
4. 無既存 project、帶 `--force`:no-op,行為與不帶 `--force` 相同(回傳碼
   0,`post_all` 各呼叫一次)。

範圍外(維持 G1 核准):不修改 `main()` 的防護邏輯本身;不修改
`seed/catalog.py` 情境內容;不涉及 Portal/BFF/Agent 清冊資料庫;不涉及伺服
器或部署;不測試 `generate()`/`Collector`/`cohorts()` 本身;不針對 manifest
檔案內容(或 traces/spans 的 row 內容)做斷言。

## 介面/API 契約
無。本 Story 只新增測試檔案,不新增/變更任何對外介面。

## 資料模型
無新增資料模型。

## 關鍵技術決策

- **新增測試檔案 `seed/tests/test_generate_guard.py`**——沿用既有命名慣例
  (`test_generate_determinism.py` 測 `generate()` 的決定性、
  `test_anchor.py` 測 `anchor.py`、`test_registry.py` 測 `registry.py`);
  本檔案專測 `generate.py::main()` 的覆寫防護分支,與測決定性的
  `test_generate_determinism.py` 職責分開,互不重疊。

- **直接呼叫 `generate.main()`,不用 subprocess、不用 CliRunner**——本專案
  沒有 click,`main()` 本身就是 `argparse` + `sys.exit(main())` 的裸
  function,且既有測試套件(`test_anchor.py`、`test_registry.py`)全部走
  「直接 import 並呼叫函式」風格,無任何測試用 subprocess 啟動腳本。用
  `monkeypatch.setattr(sys, "argv", [...])` 模擬 CLI 參數,呼叫完直接讀
  `main()` 的回傳值(整數)作為退出碼斷言對象,不必真的 `sys.exit`。

- **monkeypatch 目標是 `generate.api`、`generate.project_ids`、
  `generate.post_all`,不是 `client.api`/`client.project_ids`/
  `ingest.post_all`**——`generate.py` 頂部用
  `from client import api, iso, load_prices, project_ids, save, uuid7_at`
  與 `from ingest import post_all` 把名字直接綁進自己的模組命名空間;測試
  執行時這些 import 早已完成,`monkeypatch.setattr(client, "api", ...)`
  改的是 `client` 模組的屬性,不會反映到 `generate.api` 這個已經綁定好的
  獨立參照上。必須對 `generate` 模組本身的屬性下手,`main()` 內部呼叫的
  才會是假函式。

- **額外 `monkeypatch.setattr(client, "OUT_DIR", tmp_path)`**——`main()`
  無論哪個分支都會呼叫 `save(...)`(dry-run 落 `manifest_dryrun.json`,
  `--write` 成功後落 `manifest.json`)。`save` 是 `client.save`,其函式本
  體讀的是定義模組(`client`)裡的全域 `OUT_DIR`,所以只要改
  `client.OUT_DIR`(不需要另外重新綁定 `generate.save`,也不需要像
  `test_registry.py` 的 `export_registry()` 案例那樣重新指派 `save`)
  就能讓所有分支的檔案寫入落在 `tmp_path`,不會動到真實的 `seed/out/`。

- **既存 project 用 `catalog.AGENTS[0].key` 模擬,而非任意字串**——
  `main()` 判斷既存與否的邏輯是
  `set(project_ids(c)) & {a.key for a in AGENTS}`,必須用真正會出現在這個
  集合交集裡的 key 才能正確驅動「有既存」分支;假 `project_ids(c)` 回傳
  `{AGENTS[0].key: "fake-project-id"}`(有既存)或 `{}`(無既存),讓測試
  邏輯與production code 判斷既存的方式完全對齊,不是重新發明一套獨立判斷
  規則。

- **`api()` 的假實作回傳一個不透明的 sentinel 字串(例如
  `"FAKE_CLIENT"`),不建立真的 `httpx.Client`**——這個回傳值只會被原封
  不動傳給同樣被假掉的 `project_ids`/`post_all`,從未真正發出 HTTP
  請求,因此測試不需要、也不應該依賴 `OPIK_BASE_URL` 環境變數;符合
  CONSTITUTION.md「需要真實 backend 的測試才略過,且絕不在 CI 跑」的測試
  哲學的反面——這組測試完全不碰真實 backend,所以必定能在 CI 跑。

- **斷言風格:純 `monkeypatch.setattr` + 手寫 call-recording closure(把
  每次呼叫的 `(args, kwargs)` append 進一個 list),不用
  `unittest.mock.Mock`/`pytest-mock`**——`seed/tests/` 現有四個測試檔案
  全部只用 pytest 內建的 `monkeypatch` fixture,專案依賴裡也沒有
  `pytest-mock`,不引入新的測試依賴,維持既有風格一致。「未被呼叫」用
  `assert calls == []` 斷言;「呼叫一次/兩次」用 `len(calls) == N` 搭配
  檢查每次呼叫的 `path`/`key`/`label` 位置引數是否符合預期(例如
  `post_all(c, "/v1/private/traces/batch", "traces", col.traces,
  label="traces")` 的 `path="/v1/private/traces/batch"`、`key="traces"`、
  `label="traces"`),但刻意不比對 `rows`(即 `col.traces`/`col.spans`)
  的實際內容——這等同 manifest 內容的範圍外排除,rows 的筆數與內容由
  `generate()` 決定,不是本 Story 要驗證的對象。

- **四條測試全部固定 `--anchor 2026-01-01`**——與
  `test_generate_determinism.py` 用的固定 `ANCHOR` 一致,純粹是避免
  `main()` 內 `datetime.now(UTC)` 分支帶入「執行當下日期」造成的非必要
  不確定性(雖然本 Story 任何斷言都不依賴 anchor 的具體值),不是 spec
  要求、也不影響任何斷言結果。

- **AC4(無既存時 `--force` 為 no-op)用同一個測試函式內跑兩次
  `main()`——一次不帶 `--force`、一次帶 `--force`,兩次都用「無既存」的
  假 `project_ids`——並斷言兩次的回傳碼與 `post_all` 呼叫形狀(path/key/
  label 的序列)完全相同**——直接對應 Gherkin AC4 原文「行為與不帶
  `--force` 相同」這個「相同」的語意,而不是只驗證帶 `--force` 那一側的
  單一分支結果,避免遺漏「兩者必須一致」這個比較本身。

- **四條測試共用一個 `_run(monkeypatch, tmp_path, argv_tail, existing)`
  helper**,回傳 `(returncode, api_calls, project_ids_calls,
  post_all_calls)`,仿照 `test_generate_determinism.py` 的
  `_run_twice()` 共用 helper 寫法,避免四個測試各自重複 monkeypatch
  樣板程式碼。

## UI 原型
無,本 Story 不涉及前端 UI(純 Python CLI 防護邏輯的測試覆蓋)。

## 開放設計問題(定稿時必須為空)
(無)
