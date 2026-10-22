# 設計文件 — SDLCCT-57 Containerize Portal frontend and BFF (Docker)

## 對應需求規格

對應 G1 已核准的需求規格「Containerize Portal frontend and BFF
(Docker)」：產出 `frontend/` 與 `bff/` 的 Dockerfile、一份
docker-compose service 定義、以及容器環境變數需求清單，供維運人員在與
Opik 相同的 AWS Lightsail host 上手動部署。6 條 AC 對應範圍：

1. `docker build -f frontend/Dockerfile frontend`（context 為
   `frontend/` 自己子目錄，2026-10-21 測試階段勘誤修正，見下方
   Dockerfile 區塊的 Build with 註解）可在隔離環境成功（無連線、無
   runtime 注入的預設值）。
2. `docker build -f bff/Dockerfile bff`（context 為 `bff/` 自己子目錄，
   同一次勘誤修正）以 uv 管理依賴，可在隔離環境成功（無寫死的機密/
   主機位址）。
3. docker-compose 檔案語法正確（`docker compose -f <file> config` 成功，
   不實際啟動容器）。
4. compose 檔案明確記載 overlay-vs-standalone 的選擇與理由（本文件
   「關鍵技術決策 #1」）。
5. 所有必要環境變數列出清單，標明僅能由人類在主機上設定，repo 內零
   預設值/真實值。
6. CONSTITUTION 衛生自我檢查：新增檔案中零真實 IP/主機名/網域、SSH
   金鑰、token 樣式字串。

本票是全新產出（repo 目前無任何 Dockerfile），不修改既有程式碼邏輯，
僅新增容器化設定檔案與（如下所述）一行 Next.js 設定調整。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：不連線任何伺服器、不
執行任何 docker 指令、不驗證容器實際跑起來；反向代理設定
（SDLCCT-58）；主機原有 Opik 服務的任何改動（含版本）。

**無法從 repo 內容驗證的事實**：`~/opik/deployment/docker-compose/
docker-compose.yaml` 與 `~/opik-ops/ops.yaml` 的實際內容只存在於人類
的主機操作紀錄（HANDOFF），不在本 repo 中，架構師與開發者皆不得連線
主機讀取、也不得在設計或程式碼中臆測/杜撰其真實內容（服務名稱、網路
名稱、連接埠號等）。以下設計在提及這兩個檔案時，僅引用其「作為標準
docker-compose 檔案在結構上必然具備的形狀」（即：某個 compose 檔案存在、
定義了若干 service），不假設任何具體欄位值；凡觸及其具體內容之處，均
明確標示為「待人類在部署時核對的假設」。

## 介面/API 契約

無對外 HTTP 介面變更（不新增/變更任何 BFF 端點或前端路由）。本票的
「契約」是容器建置/組裝介面，定義如下：

### `frontend/Dockerfile`（多階段建置）

```dockerfile
# syntax=docker/dockerfile:1
# Build with: docker build -f frontend/Dockerfile frontend
#   (context = this file's own directory, matching
#   deploy/docker-compose.portal.yml's build.context: ../frontend)

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time,
# not at container start — it MUST be supplied as a build arg, not only
# as a runtime `environment:` entry (see 關鍵技術決策 #2).
ARG NEXT_PUBLIC_BFF_URL
ENV NEXT_PUBLIC_BFF_URL=${NEXT_PUBLIC_BFF_URL}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- 建置階段**不**需要連線任何主機/Opik；`NEXT_PUBLIC_BFF_URL` 若未傳入
  `--build-arg`，`ARG`/`ENV` 保持空字串——image 仍會建置成功（滿足
  AC1「no runtime-injected defaults needed」中「建置不中斷」的要求），
  但 `runner` 階段啟動的應用程式呼叫 BFF 時會打到空 base URL 而失敗，
  這是刻意行為，不是缺陷：repo 內不可寫入任何預設值（CONSTITUTION 公開
  repo 衛生），由人類在 `docker build` 時傳入真實值。
- `runner` 階段使用 `.next/standalone`，要求 `next.config.ts` 設定
  `output: "standalone"`（見關鍵技術決策 #3）。

### `bff/Dockerfile`（多階段建置，uv 管理依賴）

```dockerfile
# syntax=docker/dockerfile:1
# Build with: docker build -f bff/Dockerfile bff
#   (context = this file's own directory, matching
#   deploy/docker-compose.portal.yml's build.context: ../bff)

FROM python:3.12-slim AS builder
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runner
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# OPIK_BASE_URL has no default anywhere in this image or in api/app.py
# (CONSTITUTION: "missing value is an error, not a fallback") — the
# process fails fast at startup if the human has not supplied it.
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

- 建置階段只用 `bff/pyproject.toml` + `bff/uv.lock`（已存在於 repo）
  安裝依賴，不連線 PyPI 以外的任何主機，不含任何機密/主機位址
  （滿足 AC2）。
- `--host 0.0.0.0` 是容器內部繫結慣例（讓 compose 的 port mapping 生效），
  與目前 `project-profile.yaml` 的 `bff_run`（本機 `--reload`，給開發用）
  是兩個不同用途的指令，不互相取代。

### docker-compose service 定義：`deploy/docker-compose.portal.yml`（新增，獨立檔案）

```yaml
# Portal (frontend + bff) container definitions.
#
# OVERLAY vs STANDALONE: this file is STANDALONE — see
# docs/design/SDLCCT-57.md 關鍵技術決策 #1 for the rationale. It is not
# merged with (`-f base.yml -f this.yml`) the host's existing Opik
# compose file, and defines no dependency on that file's internal
# service/network names, none of which this repo can verify.
#
# Deploy alongside the existing Opik stack as a second, independent
# `docker compose -f deploy/docker-compose.portal.yml up -d` on the same
# host. All values below with no default are REQUIRED and MUST be
# supplied by the human operator at deploy time (e.g. via a host-local
# .env file that is never committed) — see "環境變數需求清單" below.
services:
  bff:
    build:
      context: ../bff
      dockerfile: Dockerfile
    environment:
      OPIK_BASE_URL: ${OPIK_BASE_URL:?OPIK_BASE_URL must be set}
    ports:
      - "${BFF_HOST_PORT:?BFF_HOST_PORT must be set}:8000"
    restart: unless-stopped

  frontend:
    build:
      context: ../frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_BFF_URL: ${NEXT_PUBLIC_BFF_URL:?NEXT_PUBLIC_BFF_URL must be set}
    ports:
      - "${FRONTEND_HOST_PORT:?FRONTEND_HOST_PORT must be set}:3000"
    restart: unless-stopped
    depends_on:
      - bff
```

- `${VAR:?message}` compose 語法：變數未設定時 `docker compose config`
  本身就會報錯並停止——這是刻意選擇，直接把 AC5「零預設值」做成可機器
  驗證的硬性約束，而不只是文件上的提醒（呼應 CONSTITUTION「missing
  value is an error, not a fallback」，見關鍵技術決策 #4）。
- 不含 `networks:`/Opik 容器參照：`bff` 連線 Opik 完全透過
  `OPIK_BASE_URL`（一個 HTTP URL 字串，可指向 Opik 容器對主機發布的
  連接埠，例如 `http://localhost:<opik 發布的埠>` 或主機內部 DNS 名稱），
  由人類依據其對主機既有拓樸的實際知識填入，本檔案不需要、也不應該
  臆測 Opik compose 檔案內部的 service/network 名稱。

## 資料模型

無新增/變更持久化資料模型。無新增 BFF 端點或 schema。

## 關鍵技術決策

### 1. STANDALONE（獨立檔案），不是 OVERLAY（`-f` 疊加合併）

AC4 要求本設計明確選擇並記載理由。選擇 **standalone**：

- 本票明文禁止讀取/連線主機取得 `~/opik/deployment/docker-compose/
  docker-compose.yaml` 與 `~/opik-ops/ops.yaml` 的真實內容
  （「不要連線伺服器、不要臆測內容」）。
- `docker compose -f base.yml -f override.yml` 的 overlay 合併語義要求
  override 檔案中的 service 名稱、網路名稱若要與 base 互動（例如共用
  network 讓 bff 直接用容器名稱連 Opik），必須與 base 檔案的實際內容
  精確對齊——而這份 base 檔案的內容對本 repo 不可見、不可驗證。在內容
  未知的情況下寫一個「假裝知道」的 override，一旦欄位名稱猜錯，最壞情況
  是 `docker compose config`/`up` 直接把猜錯的設定套用到 Opik 既有服務
  上，牴觸範圍外明文限制「不涉及主機原有 Opik 服務的任何改動」。
- Standalone 檔案完全不參照 Opik 檔案的任何內部名稱，只透過
  `OPIK_BASE_URL`（一個單純的 HTTP URL 環境變數，本專案既有慣例）連線，
  與 Opik 的 compose 檔案在檔案層級零耦合、零相依，符合「可疊加使用但
  不冒意外動到 Opik 既有服務風險」的需求描述字面意思（spec 原文「與主機
  上既有 compose 疊加使用，具體方式由架構師決定」——這裡的「疊加」被
  理解為「同一台主機上並存執行兩個獨立 compose 專案」，而非 compose CLI
  的 `-f` 合併語義；見下方開放設計問題，此理解已盡可能從 spec 原文推導，
  非無依據臆測，但仍標記供人類核對）。
- 代價：若日後需要 bff 直接用容器名稱走內部 Docker network 連 Opik
  （而非透過已發布的連接埠），需要另一張票在實際看到主機檔案內容後
  再處理——本票不預先設計那個情境（CONSTITUTION 範疇紀律：「只做
  spec 要求的部分」）。

### 2. `NEXT_PUBLIC_BFF_URL` 必須是 build-time `ARG`，不能只放在 compose 的 `environment:`

Next.js 的 `NEXT_PUBLIC_*` 環境變數在 `next build` 時就被內嵌進客端
JS bundle（`frontend/lib/api-client.ts` 在 import 時就讀取
`process.env.NEXT_PUBLIC_BFF_URL` 並拋錯，且該檔案被多個 `"use client"`
元件使用，見 SDLCCT-56 設計文件）；容器啟動時再用 `environment:` 注入
對已建置好的 bundle 不生效。因此 Dockerfile 用 `ARG` + compose 的
`build.args` 傳遞，而不是只用 `environment:`——這是 Next.js 容器化的
標準已知限制，不是本票新發明的模式。

### 3. 新增 `output: "standalone"` 於 `frontend/next.config.ts`

`next build` 預設輸出需要完整 `node_modules` 才能 `next start`；
`output: "standalone"` 會把執行期必要的最小依賴樹複製進
`.next/standalone`，讓 runner image 不需要整份 `node_modules`，是
Next.js 官方文件化的容器化建議設定。這是本票在既有檔案上**唯一**需要
的一行程式異動（非新增 Dockerfile 本身的一部分，但沒有它 Dockerfile
`runner` 階段會建置失敗）——開發階段需加上，不算擴大範圍，因為沒有它
AC1 無法滿足。

### 4. 必要環境變數用 compose 的 `${VAR:?...}` 語法，不用 `environment:` 搭配文件提醒

`${VAR:?message}` 在變數未設定時讓 `docker compose config`/`up` 直接
報錯中止，比起「文件寫著必須設定但 compose 語法本身允許空字串/省略」
更貼合 CONSTITUTION「missing value is an error, not a fallback」與 AC5
「zero defaults」——把這個約束做成語法層面可驗證，而非只靠文件自律。

### 5. `.dockerignore` 各新增於 `frontend/` 與 `bff/`

排除 `node_modules`、`.next`、`.venv`、`__pycache__`、`.env*`、
`tests/`——避免本機殘留檔案或任何本機 `.env`（若開發者本機有為了跑
`frontend_dev`/`bff_run` 自建的 `.env`，CONSTITUTION 禁止其內容進
image）意外被 `COPY . .` 帶進 build context。這是 AC6 衛生檢查的
主動防線，不只是事後 grep 檢查。

## 環境變數需求清單（人類於主機設定，repo 內零預設值/真實值）

| 變數 | 用途 | 由誰/何時提供 |
|---|---|---|
| `OPIK_BASE_URL` | bff 連線 Opik 觀測後端的 base URL | 人類在主機部署時設定（環境變數或主機本機 `.env`，**不提交**） |
| `NEXT_PUBLIC_BFF_URL` | frontend 連 bff 的 base URL，**build-time** 內嵌。建議值為同源 origin（例如 `https://<PUBLIC_DOMAIN>`，**不含** `/api` 後綴——理由與具體路由見 docs/design/SDLCCT-61.md 關鍵技術決策 #1） | 人類在 `docker build`/`docker compose build` 時以 `--build-arg`/`.env` 提供 |
| `BFF_HOST_PORT` | bff 容器對主機發布的連接埠 | 人類依主機既有連接埠配置決定（避免與 Opik 現有服務衝突） |
| `FRONTEND_HOST_PORT` | frontend 容器對主機發布的連接埠 | 人類依主機既有連接埠配置決定 |

以上四者在 `deploy/docker-compose.portal.yml` 中皆以 `${VAR:?...}`
寫法強制要求、無任何預設值；repo 內（包含本設計文件）不含任何真實 IP、
網域、連接埠號或機密——範例僅用變數名稱本身說明用途。

## UI 原型

無，本 Story 不涉及前端 UI 畫面變更（純容器化設定檔案，不新增/調整
任何畫面元件）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰前端
元件/CSS），`Grep` 檢查略過。

## 開放設計問題

- `deploy/docker-compose.portal.yml` 的「與主機既有 Opik compose 疊加
  使用」是否該被理解為「同一主機上兩個獨立 compose 專案並存執行」
  （本文件關鍵技術決策 #1 採用的理解），還是人類原本期待的是
  compose CLI 的 `-f base -f override` 合併語義？規格原文「可以是獨立
  檔案，或設計成能與...疊加使用，具體方式由你決定」已授權架構師自選，
  故本題不是規格缺口，但因「疊加」一詞在 docker compose 生態中有明確
  技術含義（`-f` 合併）且與本文件選擇的含義不同，列此處供人類在 G1b
  審核時一併確認理解是否與其實際主機操作方式相容，避免交付後才發現
  部署方式與人類既有操作習慣（HANDOFF 文件中的步驟）不一致。
