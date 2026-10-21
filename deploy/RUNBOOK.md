# Portal 部署、驗證、回復 Runbook（人類執行）

本文件是**人類獨立可照做**的操作指引，涵蓋 Portal（frontend + bff）在
現有 Opik 主機上的部署、兩類驗證、以及兩種層級的回復步驟。本文件延續
`docs/design/SDLCCT-57.md`（容器化）與 `docs/design/SDLCCT-58.md`
（反向代理範本）的產出物，不重複其設計內容，只引用其佔位符名稱與檔案
路徑。

## 0. 使用前提與風險總覽

- **本主機目前沒有快照/備份機制。** 本文件所有回復步驟都是「設定還原」
  或「容器下線」，不是「狀態還原」。執行前請確實理解：一旦某個步驟
  意外影響了主機既有資料（理論上本文件任何步驟都不該觸碰 Opik 既有
  資料，但沒有快照可還原這個事實本身就是風險），無法單純用本文件的
  回復步驟復原到執行前的完整狀態。
- **本文件全程只使用佔位符，執行時由人類自行替換為真實值，替換後的
  檔案或指令輸出，不得提交回本 repo。** 本文件使用的佔位符總表（共
  七個，分別來自 SDLCCT-57 與 SDLCCT-58）：

  | 佔位符 | 來源 | 用途 |
  |---|---|---|
  | `OPIK_BASE_URL` | SDLCCT-57 | bff 連線 Opik 觀測後端的 base URL |
  | `NEXT_PUBLIC_BFF_URL` | SDLCCT-57 | frontend 連 bff 的 base URL（build-time 內嵌） |
  | `BFF_HOST_PORT` | SDLCCT-57 | bff 容器對主機發布的連接埠 |
  | `FRONTEND_HOST_PORT` | SDLCCT-57 | frontend 容器對主機發布的連接埠 |
  | `<PUBLIC_DOMAIN>` | SDLCCT-58 | 對外網域（沿用既有 sslip.io 格式） |
  | `<PORTAL_PUBLIC_PORT>` | SDLCCT-58 | Caddy 導向 Portal 的連接埠（即 `FRONTEND_HOST_PORT` 的實際值） |
  | `<OPIK_INTERNAL_PORT>` | SDLCCT-58 | Opik 僅供主機內部存取的連接埠 |

- **誰可以執行本文件：僅限人類維運人員。** AI（包含架構師、開發者等
  本框架的任何子代理）不得代為執行本文件任何一個步驟、不得連線主機、
  不得代為下達任何部署/回復指令（沿用 SDLCCT-57/58 設計文件已寫明的
  E6 epic 限制）。

## 1. 部署前檢查

- 確認 `deploy/docker-compose.portal.yml`（SDLCCT-57 產出物）已在本地
  通過其自身驗收條件：`docker compose -f deploy/docker-compose.portal.yml
  config` 語法驗證成功（不實際啟動容器）。本 runbook 不重做這項檢查，
  只在部署開始前再次確認此產出物存在且已通過其 Story 的驗收。
- 確認 `deploy/Caddyfile.template`（SDLCCT-58 產出物）已通過其自身驗收
  條件：檔案內容是合法 Caddyfile 語法（註解區塊 + 一個對外 site block），
  且不含任何真實主機值。同樣不重做檢查，只確認產出物已通過驗收且存在。
- 確認人類已自行準備好以下**真實值**，且只存在於人類自己的主機操作
  紀錄中，不寫入任何檔案、Jira 票、或本文件：
  - 四個 compose 環境變數的真實值：`OPIK_BASE_URL`、
    `NEXT_PUBLIC_BFF_URL`、`BFF_HOST_PORT`、`FRONTEND_HOST_PORT`。
  - 三個 Caddy 佔位符的真實值：`<PUBLIC_DOMAIN>`、
    `<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>`。

## 2. 部署步驟

> 以下每一步驟請依序執行並逐一核取。步驟 4、5 旁標有風險警告，請特別
> 留意。

1. 在主機上，以人類持有的真實值建立 compose 用的環境檔（檔名由實際
   操作者自訂，例如 `.env`；**此檔案不得提交進 repo**），填入
   `OPIK_BASE_URL`、`NEXT_PUBLIC_BFF_URL`、`BFF_HOST_PORT`、
   `FRONTEND_HOST_PORT` 四個真實值。
2. 執行：
   ```
   docker compose -f deploy/docker-compose.portal.yml build
   docker compose -f deploy/docker-compose.portal.yml up -d
   ```
   （本檔案為 standalone 設計，與主機既有 Opik compose 並存執行，不假設
   以 `-f` 疊加合併；見 `docs/design/SDLCCT-57.md` 關鍵技術決策 #1。）
3. 核取：
   ```
   docker compose -f deploy/docker-compose.portal.yml ps
   ```
   顯示 `frontend`、`bff` 兩個服務皆為 `running`/`healthy`。若有任一
   服務非正常狀態，停止後續步驟，排除問題後再繼續。
4. **【風險警告】** 以人類持有的真實值取代 `deploy/Caddyfile.template`
   的 `<PUBLIC_DOMAIN>`、`<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>`
   三個佔位符，套用到主機既有的 `/etc/caddy/Caddyfile`。
   **在執行本步驟之前，請先手動複製一份目前的 `/etc/caddy/Caddyfile`
   留存（例如 `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.<日期>`）
   ——這是第 5 節層級一回復步驟唯一的依據，請勿略過。** 套用新設定的
   方式若覆寫既有檔案而非以新增 site block 的方式並存，可能影響 Opik
   既有服務的可用性，請謹慎操作、確認未誤刪既有 Opik 相關 site block。
5. **【風險警告】** 執行 Caddy 設定重載（例如 `caddy reload --config
   /etc/caddy/Caddyfile`；確切指令形式依主機實際 Caddy 安裝方式
   ——systemd 服務或獨立二進位——由操作者自行調整，本文件不假設哪一種）。
   reload 失敗或設定內容有誤，會直接影響 Opik 原有對外可用性，請在
   reload 後立即執行第 4 節的驗證步驟 B 確認 Opik 仍維持不對外可存取、
   且第 3 節確認 Portal 可正常對外存取。
6. 核取：從對外網域（人類自行輸入，不寫入本文件）存取，回應的是 Portal
   畫面，而不是 Opik 畫面或 Caddy 的預設頁面。

## 3. 驗證步驟 A — Portal 顯示真實資料

目的：確認 Portal 畫面顯示的是真實資料，而非假資料/寫死的數字。

1. 在主機（或任何能存取同一份資料的環境）執行 `seed/` 既有指令乾跑：
   `uv run python generate.py`（不帶 `--write`，不重新寫入 Opik），取得
   乾跑產出的 manifest；或直接讀取部署時主機上已存在的
   `seed/out/manifest.json`（若主機上曾執行過 `--write`）。
2. 比對下列欄位，與 Portal 畫面顯示的數字進行**量級/欄位存在性**比對
   （非逐位元組相等——`totals`/`daily cost` 會隨時間持續累積，比對方式
   以「數量級相符」與「欄位有對應值」為準，不要求絕對相等）：
   - `manifest["totals"]["traces"]` / `manifest["totals"]["spans"]`：
     與 Portal 任一畫面顯示的 trace/span 總數量級相符。
   - `manifest["projects"][<agent_key>]["daily"][<date>]["cost"]`：
     與 Portal 該 agent 當日成本數字一致。
   - `manifest["incidents"]`：此非空清單中，至少有一筆能在 Portal
     異常/incident 相關畫面（若該畫面存在）對上相符的 agent/時間窗。
3. 預期結果：
   - **PASS**：以上數字吻合，視為「Portal 顯示真實資料」。
   - **FAIL**：任一數字為 0，或與 manifest 顯示的非零值對不上，視為
     失敗。**不得**因為「暫時沒資料」而放行，必須回報並排查，不可逕自
     判定為可接受。

## 4. 驗證步驟 B — Opik 已不再對外可存取

目的：確認 Opik 的既有前端/API 不再被任何對外 site block 曝露。

1. 從對外網域（人類輸入的真實 `<PUBLIC_DOMAIN>`，不寫入本文件）嘗試
   直接存取 Opik 既有已知路徑（例如其登入頁或 API root；具體路徑由
   操作者依其對 Opik 實際介面的既有知識決定，本文件不臆測 Opik 介面
   細節）。
2. 預期結果：
   - **PASS**（連線失敗或被拒絕，以下兩種樣貌皆算通過）：
     - Caddy 回應該路徑對應到 Portal 的內容（代表 Opik 根本沒有被路由
       到）；或
     - 若 Opik 路徑恰好與 Portal 某個路徑同名而被導到 Portal 內容，
       視為「Opik 原內容不可見」，同樣算通過。
   - **FAIL**：對外網域回應任何可辨識為 Opik 介面/API 回應的內容（例如
     Opik 的登入畫面、Opik 特有的 API 錯誤格式），即為失敗，**必須回報
     並中止**，不得略過，應立即執行第 5 節回復步驟。
3. 額外核取（可選）：
   ```
   curl -I https://<PUBLIC_DOMAIN>/<opik路徑>
   ```
   檢查回應標頭是否含有任何 Opik 專屬標頭特徵。若操作者無法事先得知
   Opik 的標頭特徵，可省略本項，僅保留步驟 2 的純內容比對作為判準。

## 5. 回復步驟

### 5.1 層級一：僅重載 Caddyfile 回舊設定

- **觸發情境**：第 2 節步驟 4-6（套用新 Caddy 設定）之後出現問題，但
  容器本身運作正常，判斷是反向代理設定造成的問題（例如對外網域打不到
  Portal、或 Opik 透過某個新 site block 意外重新曝露——第 4 節驗證
  FAIL）。
- **步驟**：將 `/etc/caddy/Caddyfile` 還原為第 2 節步驟 4 執行前手動
  複製的備份複本（例如 `cp /etc/caddy/Caddyfile.bak.<日期>
  /etc/caddy/Caddyfile`），接著重新執行 Caddy 設定重載。
  > 這份複本是本 runbook 要求人類在套用前手動建立的「單檔備份」，**不是**
  主機層級的快照/備份機制（第 0 節已聲明主機無此機制）。
- **【風險警告】** 重載本身會短暫中斷所有經過 Caddy 的流量（Portal 與
  Opik 皆受影響，數秒級），請在流量較低時段操作。

### 5.2 層級二：停掉新容器、必要時回舊版本

- **觸發情境**：容器本身異常（crash loop、連不上 `OPIK_BASE_URL`），或
  層級一回復已執行但問題仍未解決，需要把 Portal 容器整組下線。
- **步驟**：
  ```
  docker compose -f deploy/docker-compose.portal.yml down
  ```
  若主機已留存舊版本 image（視主機既有的 image 版本管理慣例而定），可
  改用舊的 image tag/commit 重新啟動：
  ```
  docker compose -f deploy/docker-compose.portal.yml up -d
  ```
  （搭配舊版本 image 的具體指令形式，依主機實際 image 版本管理方式由
  操作者自行調整，本文件不假設固定做法。）
- **【風險警告】** Portal 服務本身會暫停，但 Opik 不受影響——Portal
  容器與 Opik 既有服務在 SDLCCT-57 standalone 設計下彼此獨立，下線
  Portal 不會動到 Opik。

## 6. 已知限制

- **主機無快照/備份機制。** 本文件上述回復步驟是「設定還原」（5.1）與
  「容器下線」（5.2），不是「狀態還原」。若 Opik 既有資料在部署過程中
  被意外影響（本文件任何步驟理論上都不該觸碰 Opik 資料，但本節明文
  記錄此限制作為風險揭露），沒有備份可供還原，這是本文件無法消除、
  只能透過謹慎操作降低風險的既有限制。
- **無法從 repo 內容驗證的事實**：主機既有 Opik compose（`~/opik/
  deployment/docker-compose/docker-compose.yaml`、`~/opik-ops/
  ops.yaml`）與 `/etc/caddy/Caddyfile` 的實際內容，延續
  `docs/design/SDLCCT-57.md`、`docs/design/SDLCCT-58.md` 已記錄的同一類
  限制：只存在於人類自己的主機操作紀錄，本 repo 無法驗證其具體內容。
  執行本文件時，請以主機當下實況為準，不是本文件假設的狀況。
- 第 2 節步驟 2/5 與第 5 節 5.2 的具體 CLI 指令（Caddy reload 的確切
  指令形式、舊版本 image 的版本管理方式），因取決於主機既有環境而以
  範例指令形式呈現，請依主機實況調整。
