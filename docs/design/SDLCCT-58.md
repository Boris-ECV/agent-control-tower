# 設計文件 — SDLCCT-58 Reverse proxy routing template (Caddy): Portal public, Opik internal-only

## 對應需求規格

對應 G1 已核准的需求規格「Reverse proxy routing template (Caddy): Portal
public, Opik internal-only」：產出一份 Caddyfile 設定**範本**，示範把
對外網域（沿用既有 `sslip.io` 網域格式，人類已決定不等品牌素材到位）
導向 Portal（SDLCCT-57 容器化後的 frontend 對外 port），並以附帶說明
記載 BFF 如何透過主機內部位址連線 Opik（不經過對外網域），同時確保 Opik
原本的前端/API 不再被任何對外 site block 曝露。5 條 AC 對應範圍：

1. 對外網域 site block 的 `reverse_proxy` 目標是 Portal 容器對外 port
   的佔位符，不是 Opik 的任何 port。
2. BFF 連線 Opik 的位址以內部/localhost 形式佔位符記載於附帶說明區塊，
   明確標註不經過對外網域 site block。
3. 範本中所有對外 site block 的 `reverse_proxy` 目標都不指向 Opik。
4. 範本中沒有真實主機特定值（網域、IP、port），可用腳本化字串/正規
   表達式掃描驗證零真實值。
5. CONSTITUTION.md 公開 repo 衛生自檢：零違規。

本票是全新產出（repo 目前無任何 Caddyfile 或 `deploy/caddy` 目錄，已
`Grep` 確認）。範本檔案本身即是交付物，不修改任何既有程式碼。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：不連線主機、不修改
實際 `/etc/caddy/Caddyfile`、不重載 Caddy（套用是人類的事，見
SDLCCT-59 的 runbook）；TLS 憑證申請（Caddy 既有自動憑證機制續用，無
新邏輯）；容器化本身（SDLCCT-57 範圍，已有設計文件，本文件僅在命名上
對齊，不重複設計）。

**無法從 repo 內容驗證的事實**：主機上現行 `/etc/caddy/Caddyfile` 的
實際內容（現有把對外網域導到 `localhost:5173` 的設定、Opik 實際佔用
的內部 port 等）只存在於人類自己的主機操作紀錄，不在本 repo 中，也不
得連線主機讀取。本文件不引用、不臆測其具體欄位值；凡提及這份現行檔案
之處，僅描述其「作為標準 Caddyfile 在結構上必然具備的形狀」（即：存在
若干 site block，其中之一把對外網域導向某個 `reverse_proxy` 目標）。

## 介面/API 契約

無對外 HTTP 介面變更（不新增/變更任何 BFF 端點或前端路由；本票不涉及
應用程式程式碼）。本票的「契約」是這份 Caddyfile 範本本身的設定語法與
佔位符介面：

### 範本檔案：`deploy/Caddyfile.template`（新增，獨立檔案）

```caddyfile
# Caddyfile TEMPLATE — Portal public, Opik internal-only.
#
# This is a TEMPLATE, not a file ready to apply. Every value in angle
# brackets below is a placeholder; this repo contains no real hostname,
# IP, or port (CONSTITUTION: public repository hygiene). A human
# operator must replace every placeholder with the real value when
# applying this to the actual host's /etc/caddy/Caddyfile — see
# docs/design/SDLCCT-59.md (deployment runbook) for the applying
# procedure. This file is never connected to a live host, never
# reloaded, by any AI in this project (E6 epic constraint).
#
# Naming of the Portal-side port placeholder matches
# docs/design/SDLCCT-57.md's FRONTEND_HOST_PORT env var (the host port
# the frontend container publishes) — same concept, same number, just
# expressed here as a Caddy-side placeholder instead of a compose env
# var, so a human operator can cross-reference the two documents.

# --- PUBLIC site block: the ONLY publicly reachable surface ---
# <PUBLIC_DOMAIN> keeps the existing sslip.io domain-name FORMAT already
# in use on the host (human decision: reuse sslip.io, do not wait for
# branding/a real domain) — e.g. it resolves to something shaped like
# <PORTAL_PUBLIC_IP>.sslip.io, but the actual IP/domain is never written
# here.
<PUBLIC_DOMAIN> {
	# Routes to Portal's frontend container, published on the host at
	# <PORTAL_PUBLIC_PORT> (== SDLCCT-57's FRONTEND_HOST_PORT value, once
	# a human has assigned it on the real host).
	reverse_proxy localhost:<PORTAL_PUBLIC_PORT>

	# Caddy's automatic TLS (existing mechanism, reused as-is — no new
	# logic needed; see 範圍外 above and 關鍵技術決策 #3 below).
}

# --- NOTE: no site block below routes any public domain to Opik. ---
# Opik's own frontend/API are NOT given a public site block by this
# template (AC3). They remain reachable ONLY from inside the host, via
# the internal addresses documented below — never through a Caddy site
# block bound to a public domain.

# =====================================================================
# INFORMATIONAL ONLY — not a Caddy site block, not applied by Caddy.
# Documents how BFF reaches Opik: entirely through host-internal
# addresses, never through the public-domain site block above (AC2).
# =====================================================================
#
#   BFF  --(host-internal, e.g. localhost:<OPIK_INTERNAL_PORT>)-->  Opik
#
# <OPIK_INTERNAL_PORT>: the port Opik's own frontend/API are published
# on, on the SAME host, for host-internal callers only (loopback/internal
# interface — not bound to <PUBLIC_DOMAIN>, not in any public site block
# above). This matches the existing BFF env var OPIK_BASE_URL from
# docs/design/SDLCCT-57.md — e.g. a human-supplied value shaped like
# `http://localhost:<OPIK_INTERNAL_PORT>` — this template does not
# redefine that variable, only documents that whatever host-internal
# value the human assigns it, it must stay off the public site block.
```

- `<PUBLIC_DOMAIN>`、`<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>`：三個
  佔位符，逐一對應 AC1/AC2/AC4——是 spec「範圍」一節明文列出的三個範例
  佔位符名稱，本文件沿用原文命名，不另造新名稱。
- 檔案開頭的註解區塊與「INFORMATIONAL ONLY」區塊都是**合法 Caddyfile
  註解**（`#` 開頭），Caddy 若真的被餵這份檔案會忽略它們、不會因此
  產生語法錯誤或額外行為——但本票範圍外明文禁止實際餵給 Caddy 驗證，
  故本文件只保證其「作為文字，是合法 Caddyfile 註解語法」，不做
  `caddy validate` 之類的可執行驗證（見開放設計問題一節，非規格缺口，
  僅記錄此限制）。

## 資料模型

無新增資料模型。無新增/變更任何資料表、欄位、索引（本票為純設定檔
範本，不涉及應用程式資料）。

## 關鍵技術決策

### 1. 單一檔案 `deploy/Caddyfile.template`，不拆成「路由範本」+「說明文件」兩個檔案

Spec 的範圍要求「一份 Caddyfile 設定範本」，且 AC2 要求「附帶說明區塊」
與對外 site block 並存於同一份產出物中，讓人類套用時能一次看到「對外
導向 Portal」與「Opik 只能走內部位址」兩者的對照關係，不需要在兩個檔案
之間來回核對。說明區塊用 Caddyfile 合法註解語法寫在同一檔案裡（而不是
另開一份 `.md`），理由：這份檔案本身在部署時會被人類逐字複製/比對到
`/etc/caddy/Caddyfile`，註解留在原地，比另一份獨立文件更不容易在套用
過程中漏讀或失去同步。

### 2. 不新增 Opik 的對外 site block（即使是「被註解掉」的版本）

曾考慮的替代方案：為 Opik 保留一個對外 site block，但用 `#` 整段註解
掉，讓人類「需要時」自行取消註解。拒絕此方案：這等於在範本裡預先寫好
一個「如何把 Opik 重新公開」的現成設定，與 AC3「所有對外 site block 的
`reverse_proxy` 目標都不指向 Opik」的字面意圖（本票目的即是收斂 Opik
的公開曝露面，不是保留一個一鍵復原的後門）相違。改用純文字 INFORMATIONAL
註解區塊說明內部連線方式，不含任何可被取消註解就變成有效 site block 的
程式碼形狀。

### 3. TLS 不新增任何設定（沿用 Caddy 自動 HTTPS，範本對此沉默）

範圍外已明文排除「TLS 憑證申請」。Caddy 的自動 HTTPS 是其預設行為
（site block 的網域一旦可被外部驗證，Caddy 本身會自動取得/更新憑證），
不需要本範本額外寫入任何 `tls` 指令或 ACME 設定——與現行主機設定的既有
機制保持零變更，是「不處理」而非「本範本決定維持現狀」的差異：本文件
明確不碰這一塊，留給 Caddy 既有行為處理。

### 4. 佔位符格式統一用 `<UPPER_SNAKE_CASE>`，與 SDLCCT-57 的 compose 環境變數命名風格對齊但不是同一機制

SDLCCT-57 用 docker-compose 的 `${VAR:?...}` 語法（compose 原生的必填
變數語法，由 `docker compose config` 強制驗證）；本票的佔位符純粹是
**文字範本**裡的人類替換標記（Caddyfile 沒有內建的「必填變數」語法），
不是可由工具強制的語法。選擇 `<UPPER_SNAKE_CASE>` 角括號格式：與
`OPIK_BASE_URL`/`FRONTEND_HOST_PORT` 等既有環境變數命名風格視覺上一致
（同樣全大寫、底線分隔），方便人類套用時用純文字搜尋（例如
`grep '<[A-Z_]*>'`）掃出所有待填值，對應 AC4「可用腳本化字串/正規表達式
掃描驗證零真實值」——這正是本文件格式選擇本身要服務的可驗證性需求。

## UI 原型

無，本 Story 不涉及前端 UI 畫面變更（純反向代理設定範本檔案，不新增/
調整任何畫面元件）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰前端
元件/CSS，`deploy/Caddyfile.template` 與既有 `frontend/`、`bff/`
程式碼零接觸），`Grep` 檢查略過。

## 開放設計問題

（無）
