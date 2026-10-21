# 設計文件 — SDLCCT-59 Deployment, verification, and rollback runbook (human-executed)

## 對應需求規格

對應 G1 已核准的需求規格「Deployment, verification, and rollback
runbook (human-executed)」：產出一份**人類獨立可照做**的 runbook 文件，
從 SDLCCT-57（容器化）與 SDLCCT-58（反向代理範本）的產出物開始，依序
列出部署、資料真實性驗證、Opik 不再對外暴露的驗證、兩種層級的回復步驟，
並標示無快照/備份的風險。6 條 AC 對應範圍：

1. 有序部署步驟，全部用佔位符引用 SDLCCT-57/58 產出物名稱。
2. 真實資料驗證步驟，對照 `seed/out/manifest.json` 具體欄位/數值。
3. Opik 不可公開存取的驗證步驟，有明確可執行檢查動作與預期失敗樣貌。
4. 兩種層級回復步驟（Caddyfile-only / 停容器），各標明觸發情境。
5. 無備份風險標示 + 每個影響 Opik 可用性的步驟旁有風險警告。
6. 文件無真實主機資訊，全文繁體中文。

本票的交付物是文件本身（由開發階段撰寫），**不是**程式碼；本設計文件
的任務是把這份文件的章節結構與每一節必須包含的具體內容定案，讓開發
階段不需要自己發明章節順序或驗證對照方式。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：不執行文件裡任何步驟
（架構師與開發者皆不連線主機、不下任何部署指令）；不重複 SDLCCT-57/58
的容器化/反向代理設計內容（只引用其佔位符名稱與檔案路徑）；不建立主機
快照/備份機制（只標示其不存在的風險）。

依賴：
- SDLCCT-57（`docs/design/SDLCCT-57.md`）：compose 檔案
  `deploy/docker-compose.portal.yml`、Dockerfile `frontend/Dockerfile`／
  `bff/Dockerfile`、環境變數 `OPIK_BASE_URL`、`NEXT_PUBLIC_BFF_URL`、
  `BFF_HOST_PORT`、`FRONTEND_HOST_PORT`。
- SDLCCT-58（`docs/design/SDLCCT-58.md`）：範本檔案
  `deploy/Caddyfile.template`、佔位符 `<PUBLIC_DOMAIN>`、
  `<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>`。
- `seed/generate.py --write` 產出的 `seed/out/manifest.json`（ground
  truth；欄位見下方「驗證步驟設計」）。

## 介面/API 契約

無對外 HTTP 介面變更。本票的「契約」是**runbook 文件本身的結構**——
交付物是 `deploy/RUNBOOK.md`（新增，與 `deploy/docker-compose.portal.yml`、
`deploy/Caddyfile.template` 同目錄，理由見下方關鍵決策 #1），開發階段
必須依下列章節順序撰寫，不得自行增減頂層章節：

```
# Portal 部署、驗證、回復 Runbook（人類執行）

## 0. 使用前提與風險總覽
## 1. 部署前檢查
## 2. 部署步驟
## 3. 驗證步驟 A — Portal 顯示真實資料
## 4. 驗證步驟 B — Opik 已不再對外可存取
## 5. 回復步驟
## 6. 已知限制
```

### 第 0 節「使用前提與風險總覽」必須包含
- 一句明確聲明：**本主機目前沒有快照/備份機制**（AC5 無備份風險標示，
  獨立於任何單一步驟存在，因為它是整份 runbook 的前提風險，不是某一
  步驟才有的風險）。
- 本文件全程使用的佔位符總表（逐一列出 SDLCCT-57 的四個 + SDLCCT-58
  的三個，共七個，附一句「替換成真實值前，不得提交回本 repo」）。
- 誰可以執行本文件：人類維運人員；AI 不得代為執行任何步驟（沿用
  SDLCCT-57/58 設計文件已寫明的 E6 epic 限制）。

### 第 1 節「部署前檢查」必須包含
- 確認 `deploy/docker-compose.portal.yml`（SDLCCT-57）與
  `deploy/Caddyfile.template`（SDLCCT-58）在本地已 build/config 驗證
  過（引用兩份設計文件的 AC3：`docker compose -f ... config` 成功、
  Caddyfile 語法合法），本 runbook 不重做這些檢查，只在開始前確認
  「前置物件存在且已通過各自 Story 的驗收」。
- 確認人類已準備好四個 compose 環境變數與三個 Caddy 佔位符的**真實值**
  （人類自行持有，不寫入任何檔案/Jira/本文件）。

### 第 2 節「部署步驟」必須包含（AC1：全部用佔位符引用 SDLCCT-57/58
產出物名稱，不內嵌真實值）
依序、可逐步核取的步驟清單，至少涵蓋：
1. 在主機上以人類持有的真實值建立 compose 用的環境檔（檔名由開發階段
   決定，例如 `.env`，**明確註記「不提交進 repo」**），填入
   `OPIK_BASE_URL`／`NEXT_PUBLIC_BFF_URL`／`BFF_HOST_PORT`／
   `FRONTEND_HOST_PORT` 四個真實值。
2. 執行 `docker compose -f deploy/docker-compose.portal.yml build`，
   再 `docker compose -f deploy/docker-compose.portal.yml up -d`
   （逐字引用 SDLCCT-57 設計文件「standalone、與 Opik 既有 compose
   並存執行」的決策，不假設 `-f` 疊加）。
3. 核取：`docker compose -f deploy/docker-compose.portal.yml ps` 顯示
   `frontend`／`bff` 兩個服務皆為 `running`/`healthy`。
4. 以人類持有的真實值取代 `deploy/Caddyfile.template` 的
   `<PUBLIC_DOMAIN>`／`<PORTAL_PUBLIC_PORT>`／`<OPIK_INTERNAL_PORT>`
   三個佔位符，套用到主機既有的 `/etc/caddy/Caddyfile`（**本步驟旁需
   風險警告**，見下方關鍵決策 #3：套用新 site block 的方式若覆寫既有
   檔案而非新增，可能影響 Opik 既有服務可用性）。
5. 執行 Caddy 設定重載（例如 `caddy reload --config
   /etc/caddy/Caddyfile`，指令細節由開發階段依主機實際 Caddy 安裝方式
   — systemd/二進位 — 決定，本設計不臆測）。**風險警告**：reload 失敗
   或設定有誤會直接影響 Opik 原有對外可用性。
6. 核取：對外網域（人類自行輸入，不寫入本文件）回應 Portal 畫面，而非
   Opik 畫面或預設 Caddy 頁面。

### 第 3 節「驗證步驟 A — Portal 顯示真實資料」（AC2）
見下方「驗證步驟設計」，逐一列出可對照 `seed/out/manifest.json` 的
具體欄位與預期一致的 Portal 畫面數字。

### 第 4 節「驗證步驟 B — Opik 已不再對外可存取」（AC3）
見下方「驗證步驟設計」，給出可執行指令與預期失敗/拒絕樣貌。

### 第 5 節「回復步驟」（AC4）
兩個層級，各自獨立成小節，各標明觸發情境：

**5.1 層級一：僅重載 Caddyfile 回舊設定**
- 觸發情境：第 2 節步驟 4-6（Caddy 套用新設定）之後出現問題，但容器
  本身運作正常，判斷是反向代理設定造成的問題（例如對外網域打不到
  Portal、或 Opik 透過某個新 site block 意外重新曝露）。
- 步驟：還原 `/etc/caddy/Caddyfile` 為套用前的備份複本（**本步驟要求
  人類在第 2 節步驟 4 執行前，先手動複製一份舊 Caddyfile** ——這是
  runbook 自己要求的「單檔複本」，不是主機快照/備份機制，範圍不衝突，
  見下方關鍵決策 #4），重載 Caddy。
- 風險警告：重載本身短暫中斷所有經過 Caddy 的流量（Portal 與 Opik
  皆受影響，數秒級）。

**5.2 層級二：停掉新容器、必要時回舊版本**
- 觸發情境：容器本身異常（crash loop、連不上 `OPIK_BASE_URL`、或
  層級一已執行但問題未解決），需要把 Portal 容器整組下線。
- 步驟：`docker compose -f deploy/docker-compose.portal.yml down`；
  若已部署過舊版本 image，`docker compose -f
  deploy/docker-compose.portal.yml up -d` 搭配舊的 image tag/commit
  （由開發階段決定具體指令形式，取決於主機 image 版本管理慣例，本
  設計不臆測，見開放設計問題）。
- 風險警告：Portal 服務本身會暫停，但 Opik 不受影響（Portal 容器與
  Opik 既有服務在 SDLCCT-57 standalone 決策下彼此獨立，下線 Portal
  不會動到 Opik）。

### 第 6 節「已知限制」（AC5 的另一半）
- 明文一句：**主機無快照/備份**，上述回復步驟是「設定還原」與
  「容器下線」，不是「狀態還原」——若 Opik 既有資料在部署過程中被
  意外影響（本 runbook 的任何步驟理論上都不該碰 Opik 資料，但本節
  明文記錄此限制作為風險揭露），沒有備份可還原。
- 引用 SDLCCT-57/58 設計文件各自記錄的「無法從 repo 驗證的事實」
  （主機既有 Opik compose/Caddyfile 實際內容未知），提醒人類執行時
  需以主機當下實況為準，不是本文件假設的狀況。

## 資料模型

無新增/變更持久化資料模型。本票唯一涉及的「資料」是 runbook 文件在
第 3 節引用的既有 `seed/out/manifest.json` 既有欄位（由 SDLCCT-7 `
seed/generate.py` 既有邏輯產生，本票不新增/變更其結構），具體如下。

### 驗證步驟設計（第 3/4 節的具體對照內容）

**驗證步驟 A（真實資料，對應 AC2）**：

1. 在主機（或任何能存取同一份資料的環境）執行
   `uv run python generate.py`（乾跑，`seed/` 既有指令，不帶
   `--write`，不重新寫入 Opik），取得 `out/manifest_dryrun.json`
   或直接讀取部署時已存在的 `seed/out/manifest.json`（若主機上曾
   執行過 `--write`）。
2. 比對欄位：
   - `manifest["totals"]["traces"]` / `["spans"]` 與 Portal 任一畫面
     顯示的 trace/span 總數量級相符（非逐位元組相等，因為資料持續
     累積；比對方式由開發階段依 Portal 實際顯示的指標決定，本設計
     只定案「用 totals 做量級檢查，不要求絕對相等」，理由見下方
     關鍵決策 #5）。
   - `manifest["projects"][<agent_key>]["daily"][<date>]["cost"]`
     與 Portal 該 agent 當日成本數字一致（引用 CONSTITUTION「每個
     數字必須可追溯到 manifest 或後端查詢」）。
   - `manifest["incidents"]` 非空清單與 Portal 異常/incident 相關畫面
     （若該畫面存在）至少有一筆對得上的 agent/時間窗。
3. 預期結果：以上數字吻合視為「Portal 顯示真實資料，非假資料/硬寫
   數字」。任一數字為 0 或對不上且 manifest 顯示非零，視為失敗，
   **不得**判定為「暫時沒資料」就放行。

**驗證步驟 B（Opik 不可公開存取，對應 AC3）**：

1. 從對外網域（人類輸入的真實 `<PUBLIC_DOMAIN>`，不寫入本文件）嘗試
   直接存取 Opik 既有已知路徑（例如其登入頁或 API root；具體路徑由
   開發階段依 Opik 實際介面決定，本設計不臆測 Opik 介面細節，超出
   SDLCCT-58 的範圍）。
2. 預期結果：**連線失敗或被拒絕**，具體樣貌二選一都算通過：
   - Caddy 回應該網域對應到 Portal 的內容（代表 Opik 根本沒有被路由
     到，不是「Opik 回了 403」——這兩者都算 AC3 通過，差別只在於
     Caddy 層面是否認得這個路徑）；
   - 若 Opik 路徑恰好與 Portal 某個路徑同名而被導到 Portal，視為
     「Opik 原內容不可見」，同樣算通過。
   - 反例（失敗樣貌）：對外網域回應任何可辨識為 Opik 介面/API 回應
     的內容（例如 Opik 的登入畫面、Opik 特有的 API 錯誤格式）即為
     失敗，必須回報並中止，不得略過。
3. 額外核取：`curl -I https://<PUBLIC_DOMAIN>/<opik路徑>` 的回應標頭
   不含任何 Opik 專屬標頭特徵（開發階段若無法事先得知 Opik 的標頭
   特徵，可省略此條，保留純內容比對）。

## 關鍵技術決策

### 1. 交付物檔名定為 `deploy/RUNBOOK.md`，與 SDLCCT-57/58 的產出物同目錄

理由：人類操作時三份文件（compose、Caddyfile 範本、runbook）需要
交叉參照佔位符名稱，放在同一個 `deploy/` 目錄比起放進 `docs/` 底下
更貼近「部署時會一起打開看」的使用情境；`docs/design/SDLCCT-59.md`
（本文件）仍是設計文件本身，不是交付物，兩者不是同一份檔案——沿用
SDLCCT-57/58 設計文件已確立的「設計文件在 `docs/design/`，交付物件
在 `deploy/`」分工。

### 2. 不把「驗證步驟 A」做成逐位元組比對，只做量級/欄位存在性比對

AC2 原文只要求「可對照具體訊號」，未要求逐位元組相等；manifest 的
`totals`/`daily cost` 在真實部署環境下會隨時間持續累積（`seed/`
既有設計，非本票新增），要求絕對相等會讓這份 runbook 在任何非當下
瞬間執行都判定失敗，不符合「人類獨立照做」的可操作性。選擇量級/欄位
對照，與 CONSTITUTION「每個數字必須可追溯到來源」的精神一致（可
追溯＝可對照來源欄位，不等於逐位元組相等）。

### 3. 「套用 Caddyfile 範本」步驟旁標風險警告，且要求人類先手動備份單一檔案

CONSTITUTION「deny-by-default for anything that mutates
infrastructure」與 spec 範圍明文「任何影響 Opik 既有服務可用性的
步驟需明確風險警告」——套用新 Caddyfile 與 reload 是本文件中唯一兩個
會直接觸碰主機既有、對外運作中服務的步驟，比照對待：皆標風險警告，
且前者額外要求人類先手動複製一份舊檔（這是 runbook 操作程序的一部分，
不是「建立備份機制」——後者是範圍外明文排除的主機層基礎設施工作，
兩者層級不同，不衝突）。

### 4. 層級一回復步驟依賴「人類在部署前手動複製的單一 Caddyfile 複本」，不依賴任何系統快照

Spec 範圍外明文排除「主機快照/備份機制建立」，但驗收條件 4 要求
「僅重載 Caddyfile 回舊設定」這個回復路徑必須存在且可執行。唯一不
牴觸範圍外限制的做法：把「備份」縮小到 runbook 步驟本身的一個動作
（部署前手動 `cp` 一份檔案），而不是要求主機具備快照能力——這把
AC4 與範圍外的「無快照/備份」限制同時滿足，差異記錄在第 6 節「已知
限制」，避免人類誤以為這等同於完整的主機備份機制。

### 5. Opik 不可公開存取的驗證以「觀察對外回應內容」為主，不要求人類具備 Opik 介面知識以外的額外工具

AC3 要求「可執行檢查動作」，但本票範圍外排除連線主機（架構師/
開發者不可連線驗證），人類實際執行時具備的工具只有瀏覽器/`curl`
等既有工具，不假設人類會另外安裝網路掃描工具——與 SDLCCT-58 設計
文件「不臆測 Opik 介面細節」的既有限制一致，驗證步驟的具體路徑留給
開發階段依人類對 Opik 介面的既有知識填入，本設計只定案「比對方式」
與「失敗樣貌」的判準。

## UI 原型

無，本 Story 不涉及前端 UI 畫面變更（純文件交付物）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰前端
元件/CSS 或任何程式碼），`Grep` 檢查略過。

## 開放設計問題

- 第 2 節步驟 2/5 與第 5 節 5.2 的具體 CLI 指令細節（Caddy reload 的
  確切指令形式、舊版本 image 的 tag/版本管理方式）取決於主機既有
  Caddy 安裝方式與是否已有 image 版本留存慣例，這兩者都是「無法從
  repo 內容驗證的事實」（延續 SDLCCT-57/58 設計文件已記錄的同一類
  限制）。本設計已把能從 spec/既有產出物確定的部分定案（步驟順序、
  佔位符引用、風險警告位置、驗證對照邏輯），這兩處指令級細節留給
  開發階段依 SDLCCT-57/58 的既有佔位符撰寫成「範例指令 + 註記由人類
  依主機實況調整」的形式，不是規格缺口，僅記錄供人類在 G1b 審核時
  確認此寫法可接受。
