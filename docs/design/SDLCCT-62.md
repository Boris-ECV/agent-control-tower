# 設計文件 — SDLCCT-62 BFF container crash-loops on deploy: ModuleNotFoundError: No module named 'registry'（Bug）

## 對應需求規格

對應 G1 已核准的需求規格（Bug 修正，無新 AC 編號，依票面條列對應）：

- 根因已核實：`bff/Dockerfile` 的 build context 是 `bff/` 自己
  （`deploy/docker-compose.portal.yml` 的 `build.context: ../bff`），
  `COPY . .` 只複製 `bff/` 目錄內容；`seed/registry.py`、`seed/anchor.py`
  及其依賴的 `seed/catalog.py`、`seed/client.py` 完全不在這個 build
  context 內，但六個 `bff/api/*.py` 模組用
  `sys.path.insert(0, ...".../seed"...)` 在 runtime import 這些模組
  （本機開發時 `bff/`、`seed/` 是同一 checkout 的兩個子目錄兄弟）。
- 範圍：修正 image 建置/組裝方式，讓受影響六個模組
  （`agent_detail.py`、`agents.py`、`anomalies.py`、
  `budget_simulation.py`、`cost_overview.py`、`trace_spans.py`）
  在容器內全部能成功 `import registry`/`import anchor`。
- 修正手段由架構師決定，不得違反 SDLCCT-57 既有限制（standalone
  compose、零機密/主機位址寫死、`.dockerignore` 排除規則維持有效）。
- 修正後須 `bff_test`、`bff_lint` 全數通過，且本機
  `docker build` + `docker run` 確認不再 `ModuleNotFoundError`、不進入
  重啟迴圈。
- 範圍外：不連線任何伺服器、不改任何 API 業務邏輯、不處理
  `frontend/` 容器、不重新設計 seed/bff 套件邊界（除非是修正此問題的
  必要手段——見下方決策 #1，本設計判斷不需要重新設計邊界，只需調整
  「哪些檔案被打進 image」）。

本票不涉及前端 UI 變更（純後端/部署設定修正）。

## 介面/API 契約

無對外 HTTP 介面變更（不新增/變更任何 BFF 端點、不改任何 API 回應格式
或狀態碼——六個受影響模組的業務邏輯完全不動，只修正它們在容器內能否
被成功 import）。

本票的「契約」是 image 建置/組裝介面，定義如下：

### `bff/Dockerfile`（修改：build context 由 `bff/` 改為 repo 根目錄）

```dockerfile
# syntax=docker/dockerfile:1
# Build with: docker build -f bff/Dockerfile .   (context = REPO ROOT, not
# bff/ itself — see docs/design/SDLCCT-62.md 關鍵技術決策 #1: seed/ must
# ship alongside bff/ as siblings under /app/bff and /app/seed, matching
# bff/api/*.py's sys.path.insert(..., _BFF_ROOT.parent / "seed") runtime
# assumption, which mirrors the local checkout's bff/ + seed/ sibling
# layout exactly.)

FROM python:3.12-slim AS builder
WORKDIR /app/bff
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY bff/pyproject.toml bff/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY bff/ .
COPY seed/registry.py seed/anchor.py seed/catalog.py seed/client.py /app/seed/
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runner
WORKDIR /app/bff
COPY --from=builder /app /app
ENV PATH="/app/bff/.venv/bin:$PATH"
EXPOSE 8000
# OPIK_BASE_URL has no default anywhere in this image or in api/app.py
# (CONSTITUTION: "missing value is an error, not a fallback") — the
# process fails fast at startup if the human has not supplied it.
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

- 只有四個明確點名的 `seed/*.py` 檔案被 `COPY` 進 image（不是
  `COPY seed/ /app/seed/` 整個目錄）——精確對應票面「四個檔案」的範圍，
  不多帶 `seed/generate.py`、`seed/ingest.py`、`seed/verify.py`、
  `seed/preflight.py`（這些是對外連線 Opik 的腳本，bff runtime 完全不
  import 它們，帶進 image 沒有任何用途，只增加攻擊面/體積）。
- 不帶 `seed/model_prices.snapshot.json`：六個受影響模組都不呼叫
  `client.load_prices()`（只 import `registry`/`anchor`/`opik_metrics`/
  `opik_traces`/`opik_spans`/`anomaly_*`），這個檔案在 bff runtime 路徑
  上不會被讀取，不屬於這次修正範圍。
- `WORKDIR` 由 `/app` 改為 `/app/bff`：讓 image 內 `/app/bff`（bff 原始
  碼）與 `/app/seed`（四個檔案）維持跟本機 checkout 完全一致的兄弟目錄
  關係，`sys.path.insert` 既有程式碼邏輯（`_BFF_ROOT.parent / "seed"`）
  不需要任何改動就能在容器內解析到正確路徑——六個受影響模組**零程式碼
  異動**。
- `CMD` 的 `uvicorn api.app:app` 字串不變：`api/` 仍在新的 `WORKDIR`
  （`/app/bff`）之下，相對路徑語意不受影響。

### `deploy/docker-compose.portal.yml`（修改：`bff` service 的 `build.context`/`dockerfile`）

```yaml
  bff:
    build:
      context: ..
      dockerfile: bff/Dockerfile
    environment:
      OPIK_BASE_URL: ${OPIK_BASE_URL:?OPIK_BASE_URL must be set}
    ports:
      - "${BFF_HOST_PORT:?BFF_HOST_PORT must be set}:8000"
    restart: unless-stopped
```

- `context: ..`（相對於 `deploy/` 目錄，即 repo 根目錄）+
  `dockerfile: bff/Dockerfile`：compose 語法本身支援 build context 與
  Dockerfile 路徑分離，不需要把 Dockerfile 移位置。
- `frontend` service 完全不動（`context: ../frontend`、
  `dockerfile: Dockerfile` 不變）——本票範圍外已明確排除 frontend
  容器，且 frontend 的 build context 與 bff 無關，互不影響。

### `bff/Dockerfile.dockerignore`（新增，取代原 `bff/.dockerignore` 對 bff image 建置的作用）

```
bff/.venv
bff/__pycache__
bff/.env*
bff/tests/
seed/.venv
seed/__pycache__
seed/tests/
seed/.env*
seed/out/
.git/
frontend/
docs/
```

- BuildKit 支援「與 Dockerfile 同目錄、檔名為
  `<Dockerfile 檔名>.dockerignore`」的 per-Dockerfile 覆寫規則，其優先權
  高於 context 根目錄的 `.dockerignore`，且規則內的路徑仍是相對於
  **build context 根目錄**（現在是 repo 根目錄），不是相對於 Dockerfile
  所在目錄。採用這個命名慣例，而不是新增一個通用的
  repo 根目錄 `.dockerignore`，是刻意的：排除規則只與 bff image 的建置
  有關，不應該意外影響未來任何其他以 repo 根目錄為 context 的建置。
- 原 `bff/.dockerignore`（`.venv`／`__pycache__`／`.env*`／`tests/`，
  相對於舊 context `bff/`）語意上**失效**（新 context 下這些相對路徑不
  再對應任何檔案，docker 也不會再讀取這個檔名）——用新檔案
  `bff/Dockerfile.dockerignore` 取代，內容是同一組排除類別，只是路徑
  改成相對 repo 根目錄（`bff/.venv` 等），延續 SDLCCT-57 AC6 的衛生檢查
  意圖，維持「本機殘留檔案/`.env` 不會進 build context」的既有限制不被
  破壞（本票範圍限制第 3 點）。
- 新增 `seed/.venv`、`seed/__pycache__`、`seed/tests/`、`seed/.env*`、
  `seed/out/`：context 擴大到 repo 根目錄後，`seed/` 也進入了 build
  context 的上傳範圍（即使最終只有四個 `.py` 檔案被 `COPY` 進 image
  layer，`.dockerignore` 排除的是「送進 docker daemon 的 context
  打包」這一步，不是最終 image 內容）——若 `seed/.env*` 這類本機檔案
  未被排除，即使從未被 `COPY`，也已經違反 CONSTITUTION「本 repo 零機密
  外洩」的精神（build context 會被傳輸給 docker daemon，不應該讓它途經
  任何本機機密檔案，即便最終沒被用到）。
- 新增 `.git/`、`frontend/`、`docs/`：純粹是效能/衛生層面的最佳化（新
  context 是整個 repo 根目錄，排除明顯與 bff image 無關的大型目錄），
  不是 AC 要求的必要項目，但零風險、零副作用，一併列入。

## 資料模型

無新增/變更持久化資料模型。無新增 BFF 端點或 schema（與
docs/design/SDLCCT-57.md 一致的結論——本票同樣是純容器化/建置層修正）。

## 關鍵技術決策

### 1. 改變 build context 為 repo 根目錄，而非重新設計 seed/bff 套件邊界或改用 BuildKit `--build-context` 具名多重 context

三個可能做法中選擇「build context 改為 repo 根目錄 + Dockerfile 用
路徑前綴 `COPY bff/...`、`COPY seed/...`」：

- **不**把 `seed/registry.py` 等四個檔案複製/搬進 `bff/` 目錄下
  （重新設計套件邊界）：違反票面「不重新設計 seed/bff 套件邊界，除非
  這是必要手段」——改 build context 已經是充分手段，不需要動到
  `seed/`、`bff/` 的目錄歸屬本身。
- **不**用 BuildKit 具名多重 context（`docker build --build-context
  seed=../seed` + Dockerfile 的 `COPY --from=seed ...`，compose 對應
  `build.additional_contexts`）：技術上可行且能維持 `bff/` 自身仍是
  主要 build context（更貼近 SDLCCT-57 原始設計的字面結構），但這是
  較新的 Compose spec 欄位，依賴未知的主機 Docker/Compose 版本——
  SDLCCT-57 設計文件已明確記載「主機既有環境的實際版本/拓樸不可從
  repo 驗證，不可臆測」的謹慎原則；選一個對任何近代 `docker
  build`/`docker compose build` 都成立的標準機制（改 context + 一般
  `COPY`）風險更低。
- 選定做法：`context: ..`（repo 根目錔）+ `dockerfile: bff/Dockerfile`
  + Dockerfile 內用 `COPY bff/...`、`COPY seed/<四個檔案> /app/seed/`
  明確點名複製。好處：(a) 六個受影響模組**零程式碼異動**——
  `WORKDIR /app/bff` 讓容器內 `/app/bff` + `/app/seed` 的兄弟關係與本機
  checkout 的 `bff/` + `seed/` 完全一致，既有的
  `_BFF_ROOT.parent / "seed"` 邏輯不需要知道自己在容器內還是本機；
  (b) 明確點名四個檔案而非整個 `seed/` 目錄，精準對應票面範圍，不多帶
  與 bff runtime 無關的腳本/資料檔。

### 2. `bff/Dockerfile.dockerignore`（per-Dockerfile 覆寫）取代 `bff/.dockerignore`

見上方「介面/API 契約」一節的理由：context 根目錄改變後，舊檔案的
相對路徑語意失效，需要一份路徑正確、且明確只作用於 bff image 建置
（不殃及其他以 repo 根目錄為 context 的未來建置）的新排除規則檔案。
採用 BuildKit 的 `<Dockerfile 檔名>.dockerignore` 命名慣例而非通用根
目錄 `.dockerignore`，是為了保持「排除規則與其所服務的 Dockerfile
共置」這個既有慣例（呼應 SDLCCT-57 `.dockerignore` 各自置於
`frontend/`、`bff/` 的做法精神）。

### 3. `frontend/` 容器與其 `.dockerignore`、build context 完全不動

票面明文「已確認不受影響」；`frontend` service 的 `build.context:
../frontend` 維持原狀，與 `bff` 的 context 變更互相獨立，兩者在
compose 檔案中各自宣告自己的 `context`/`dockerfile`，不存在任何共享
狀態會被本次修正波及。

## UI 原型

無，本 Story 不涉及前端 UI。根因與修正範圍都在 `bff/Dockerfile`、
`deploy/docker-compose.portal.yml` 與新增的 `bff/Dockerfile.dockerignore`
——純後端容器建置/組裝設定修正，不新增、不調整任何畫面元件，`frontend/`
容器本身也明確排除在範圍外（票面已確認不受影響）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰任何
前端元件/CSS/HTML），`tests/e2e/` 的樣式一致性測試檢查略過。

## 開放設計問題（定稿時必須為空）

無。修正手段完全由本票授權架構師決定（票面第 3 點），且六個受影響
模組的業務邏輯、API 契約、資料模型皆不受觸碰，沒有規格未講清楚、需要
退回或升級的產品決策。
