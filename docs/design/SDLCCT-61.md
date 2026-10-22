# 設計文件 — SDLCCT-61 Bug: browser cannot reach BFF through the only public port opened by SDLCCT-58/60

## 對應需求規格

對應 G1 已核准的 Bug 規格「browser cannot reach BFF through the only
public port opened by SDLCCT-58/60」：

**已確認根因**（G1 已定案，本文件不重新調查）：`frontend/lib/
api-client.ts` 的 `fetchJson()` 在瀏覽器端執行（由 `"use client"`
元件呼叫，例如 `agent-detail-content.tsx`、`trace-detail-content.tsx`
等），其 `fetch(\`${BFF_BASE_URL}${path}\`)` 的 `BFF_BASE_URL` 來自
`process.env.NEXT_PUBLIC_BFF_URL`，在 Docker build 時（`frontend/
Dockerfile` 的 `ARG NEXT_PUBLIC_BFF_URL`）已內嵌進客端 bundle。而
`deploy/Caddyfile.template`（SDLCCT-58）唯一的對外 site block（綁定
`<PUBLIC_DOMAIN>`）只有 `reverse_proxy localhost:<PORTAL_PUBLIC_PORT>`
一條路由，完全沒有通往 BFF 的路由——BFF 雖然在 `deploy/
docker-compose.portal.yml`（SDLCCT-57）透過 `${BFF_HOST_PORT}:8000`
發布到主機，但從未被 Caddy 對外曝露。結果：瀏覽器無法呼叫 BFF，除非
（a）額外開一個對外 port（違反 SDLCCT-60 checklist 第三項「僅開放
443」），或（b）用一個瀏覽器永遠連不到的主機內部位址。

**已定案的修法方向（G1 已核准，本文件只設計具體落地方式，不重新
選擇方案）**：在 `deploy/Caddyfile.template`**同一個**對外
`<PUBLIC_DOMAIN>` site block 下，新增一條以**路徑**（而非網域）區分的
`handle` 路由導向 `localhost:<BFF_HOST_PORT>`，其餘路徑仍導向
frontend；並修正 `docs/design/SDLCCT-57.md` 對 `NEXT_PUBLIC_BFF_URL`
建議值的描述，改為同源（same-origin）值。

7 條 AC 對應範圍與本文件決策的對照見文末「AC 對應表」。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：`frontend/lib/
api-client.ts` 或任何 client 元件的程式碼變更；Opik 曝露面的任何改動；
`BFF_HOST_PORT`/`PORTAL_PUBLIC_PORT`/`PUBLIC_DOMAIN` 佔位符語意本身；
實際連線主機驗證（CONSTITUTION：AI 不連線真正主機）；重寫
`deploy/RUNBOOK.md` 或 `deploy/OPIK-EXPOSURE-CHECKLIST.md`（本文件已
逐一核對兩份文件現有文字，確認 AC7 不需要改動兩者，見下方「Opik
曝露面不受影響的核實」與「關鍵技術決策 #3」）。

**無法從 repo 內容驗證的事實**：主機上實際套用的 Caddyfile、
`<PUBLIC_DOMAIN>`/`<PORTAL_PUBLIC_PORT>`/`<BFF_HOST_PORT>` 的真實值，
只存在於人類的主機操作紀錄，不在本 repo，也不得連線主機讀取或臆測
（延續 SDLCCT-57/58/59/60 設計文件已確立的同一類限制）。

## 介面/API 契約

無對外 HTTP 介面變更（不新增/變更任何 BFF 端點或前端路由；`bff/api/
app.py` 現有端點本身不動）。本票的「契約」是 `deploy/
Caddyfile.template` 內對外 site block 的路由結構調整，以及
`docs/design/SDLCCT-57.md` 一處文字修正：

### `deploy/Caddyfile.template` 的對外 site block（修改既有區塊，SDLCCT-58 已建立）

現有內容（第 24-32 行，僅此區塊內容變更，檔案其餘部分——包含下方
Opik INFORMATIONAL ONLY 區塊——逐字保留，見下方「Opik 曝露面不受
影響的核實」）：

```caddyfile
<PUBLIC_DOMAIN> {
	# Routes to Portal's frontend container, published on the host at
	# <PORTAL_PUBLIC_PORT> (== SDLCCT-57's FRONTEND_HOST_PORT value, once
	# a human has assigned it on the real host).
	reverse_proxy localhost:<PORTAL_PUBLIC_PORT>

	# Caddy's automatic TLS (existing mechanism, reused as-is — no new
	# logic needed; see 範圍外 above and 關鍵技術決策 #3 below).
}
```

修改後：

```caddyfile
<PUBLIC_DOMAIN> {
	# BFF route (AC1/AC2, SDLCCT-61): "/api/*" is a literal URL PATH
	# PREFIX, not a host-specific placeholder like <PUBLIC_DOMAIN> or
	# <PORTAL_PUBLIC_PORT> below. A path is part of the HTTP request
	# line, not an identifier of this particular host — it carries no
	# real hostname/IP/port, so CONSTITUTION's "no real host-specific
	# value in this repo" does not apply to it, and it stays a literal
	# string instead of an <ANGLE_BRACKET> placeholder. The literal
	# "/api" also matches bff/api/app.py's own existing route prefix —
	# every BFF endpoint is already registered under /api/... (e.g.
	# /api/cost-overview/summary, /api/agents) — so Caddy forwards the
	# matched path to BFF completely unchanged, with no rewrite/
	# strip_prefix directive needed (see 關鍵技術決策 #1 below).
	handle /api/* {
		# Routes to Portal's bff container, published on the host at
		# <BFF_HOST_PORT> (== SDLCCT-57's BFF_HOST_PORT compose env var
		# value, once a human has assigned it on the real host). This
		# stays localhost-bound/firewalled exactly like
		# <PORTAL_PUBLIC_PORT> below — reachable from outside only
		# through this reverse_proxy hop inside the single public site
		# block, never a second public port (AC3).
		reverse_proxy localhost:<BFF_HOST_PORT>
	}

	# All other paths (AC1): unchanged from SDLCCT-58 -- Portal's
	# frontend container.
	handle {
		reverse_proxy localhost:<PORTAL_PUBLIC_PORT>
	}

	# Caddy's automatic TLS (existing mechanism, reused as-is — no new
	# logic needed; see 範圍外 above and 關鍵技術決策 #3 below).
}
```

- 兩個 `handle` 區塊是 Caddy 原生「路徑式路由分派」語法：同一個
  site block 內，`handle /api/* { ... }` 與 `handle { ... }`
  （無參數、匹配其餘所有路徑）互斥、依序比對，第一個比對成功的區塊
  生效——這就是 AC1「其餘路徑仍導向 frontend；不新增 site
  block/port」要求的具體落地方式。
- 檔案開頭的總覽註解區塊（第 12-16 行，描述既有三個佔位符的跨文件
  對照）需追加一行，說明新佔位符 `<BFF_HOST_PORT>` 對應
  `docs/design/SDLCCT-57.md`/`deploy/docker-compose.portal.yml` 的
  `BFF_HOST_PORT` 環境變數——沿用 SDLCCT-58 關鍵技術決策 #4 已建立的
  「佔位符名稱直接對齊既有環境變數名稱，方便跨文件搜尋比對」慣例
  （與 `<PORTAL_PUBLIC_PORT>` 刻意改名不同，這裡直接同名，因為
  `BFF_HOST_PORT` 本身已經是清楚、無歧義的名稱，不需要像
  frontend 那樣另造一個 Caddy 專屬名稱）。
- 第 40-56 行（Opik INFORMATIONAL ONLY 區塊）**逐字不動**——見下方核實。

### `docs/design/SDLCCT-57.md` 的 `NEXT_PUBLIC_BFF_URL` 建議值修正（僅此一處，交叉引用性質）

**目前文字核實結果**：通讀 `docs/design/SDLCCT-57.md` 全文，
`NEXT_PUBLIC_BFF_URL` 目前**沒有**任何一處寫出具體的建議/範例值
（不是寫了錯誤的值，而是完全沒寫值）；僅第 244-249 行「環境變數需求
清單」表格的這一行描述其*用途*與*提供方式*，不含值本身：

> `| NEXT_PUBLIC_BFF_URL | frontend 連 bff 的 base URL，**build-time**
> 內嵌 | 人類在 docker build/docker compose build 時以
> --build-arg/.env 提供 |`

本票要修正的正是這個缺口（而非覆蓋一個錯誤值）：在同一行表格的
「用途」欄位後方，補上具體的同源建議值與其理由的交叉引用。修改後：

> `| NEXT_PUBLIC_BFF_URL | frontend 連 bff 的 base URL，**build-time**
> 內嵌。建議值為同源 origin（例如 \`https://<PUBLIC_DOMAIN>\`，**不含**
> \`/api\` 後綴——理由與具體路由見 docs/design/SDLCCT-61.md 關鍵技術
> 決策 #1） | 人類在 docker build/docker compose build 時以
> --build-arg/.env 提供 |`

**本文件選擇的具體值與 G1 規格文字的差異，已揭露**：G1 規格原文的
illustrative 範例是「`https://<PUBLIC_DOMAIN>/api`」（含 `/api`
後綴）。本設計改為**不含** `/api` 後綴的純 origin 值，理由見下方
關鍵技術決策 #1——這是「同源 base URL 的具體字串」這個實作層級的
決定（spec 原文用「e.g.」「like」字樣，本就授權架構師選定確切值，
同 SDLCCT-58 對 Caddy 路徑字面值的既有分工），不是重新開啟 G1 已核准
的「改成同源」這個方案本身；AC4「同源」、AC5「zero 前端程式碼變更」
的字面意圖兩者皆滿足，不衝突。

- 除上述一行外，`docs/design/SDLCCT-57.md`**不改動其他任何章節**
  （cross-reference 性質，不重寫該文件其餘內容）。

## 資料模型

無新增資料模型。無新增/變更任何資料表、欄位、索引（本票為純設定檔
調整，不涉及應用程式資料或任何既有資料模型）。

## 關鍵技術決策

### 1. `NEXT_PUBLIC_BFF_URL` 建議值為純 origin（不含 `/api` 後綴），Caddy 路徑前綴選 `/api/*`，兩者刻意對齊 BFF 既有路由前綴

讀 `frontend/lib/agents-api.ts`、`cost-overview-api.ts`、
`anomalies-api.ts`、`agent-detail-api.ts`、`trace-spans-api.ts` 確認：
呼叫 `fetchJson()` 時傳入的 `path` 參數本身**已經**帶有 `/api/` 前綴
（例如 `/api/cost-overview/summary`、`/api/agents`、`/api/agents/
{key}/traces/{traceId}/spans`），對應 `bff/api/app.py` 的路由也全部
註冊在 `/api/...` 下。目前本機開發用的 `NEXT_PUBLIC_BFF_URL`（例如
`.github/workflows/ci.yml`、`vitest.config.ts` 用的
`http://localhost:8000`）是**裸 origin**，`fetchJson()` 的字串串接
`${BFF_BASE_URL}${path}` 因此得到 `http://localhost:8000/api/...`，
與 BFF 實際路由完全對齊。

若依 G1 規格 illustrative 範例把 `NEXT_PUBLIC_BFF_URL` 設成
`https://<PUBLIC_DOMAIN>/api`（含 `/api` 後綴），同樣的字串串接會得到
`https://<PUBLIC_DOMAIN>/api/api/cost-overview/summary`——多了一層
重複的 `/api`，若 Caddy 的 `handle /api/*` 不做 `strip_prefix` 就會
404（因為 BFF 自己沒有 `/api/api/...` 這個路由）。要讓這個值可行，
唯一辦法是在 Caddy 端加一道「比對 `/api/*`、轉送前先剝掉一層
`/api`」的 rewrite，這會讓 Caddy 設定多一個非必要的步驟，且與
AC5「`fetchJson()` 的字串串接本來就該直接可用、不需要額外改寫」
的字面意圖相違。

改用裸 origin（`https://<PUBLIC_DOMAIN>`，不含 `/api`）+ Caddy 路徑
前綴 `/api/*`（原封不動轉送，不做 strip_prefix）：串接結果正好是
`https://<PUBLIC_DOMAIN>/api/cost-overview/summary`，與 BFF 既有路由
逐字對齊，Caddy 端不需要任何路徑改寫邏輯，`fetchJson()`/
`api-client.ts` 完全不用改——同時滿足 AC4（同源）、AC5
（零前端程式碼變更，而且是「不需要任何隱藏的路徑改寫魔法」意義下的
零變更，不只是「技術上能動但繞了一圈」）、AC1（路徑式路由、其餘
導向 frontend）。

### 2. Caddy 路由用兩個 `handle {}` 區塊，不用 `handle_path` 或 `@matcher + route`

`handle /api/*` 與 `handle {}`（無參數、比對其餘路徑）是 Caddy 文件
建議的「同一 site block 內依路徑分派多個目的地」標準寫法，彼此互斥、
依序比對，語意上最直接對應 AC1「新增一條 BFF 路由，其餘路徑仍導向
frontend」的字面描述。刻意不用 `handle_path`（它會在轉送前自動剝除
比對到的前綴），因為上面決策 #1 已確定不需要剝除前綴——用
`handle_path` 反而要額外處理「剝除後要不要補回去」的問題，徒增複雜度。

### 3. 不修改 `deploy/OPIK-EXPOSURE-CHECKLIST.md`，不修改 `deploy/RUNBOOK.md`

**核實過程**（AC7 要求逐一核對，非臆測）：
- 讀 `deploy/Caddyfile.template` 第 40-56 行「INFORMATIONAL ONLY」
  區塊（記載 BFF 連線 Opik 的內部位址 `<OPIK_INTERNAL_PORT>`）：本票
  的修改完全在第 24-32 行的對外 site block 內部，不觸碰、不移動、不
  改寫這段文字的任何一個字元；新增的 BFF 路由轉送目標是
  `<BFF_HOST_PORT>`（Portal 自己的 BFF），與 Opik 的
  `<OPIK_INTERNAL_PORT>` 是兩個不同的佔位符、兩個不同的服務，互不
  交叉。
- 讀 `deploy/OPIK-EXPOSURE-CHECKLIST.md` 全文：第 3 節「對外僅開放
  443」的 PASS 判準已經是「其餘所有 port——包含
  `<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>` 對應的真實值，**以及
  Opik/Portal 容器各自發布的任何 host port**」——這句既有的「任何 host
  port」已經以泛稱方式涵蓋了 `<BFF_HOST_PORT>`（BFF 屬於「Portal
  容器」之一），不需要新增一行專門提到 BFF；第 1、2 節只涉及 Opik
  本身的前端/API/`OPIK_BASE_URL`，與本票的 BFF 對外路由無關。
- 讀 `deploy/RUNBOOK.md`：其環境變數表格（第 21-25 行）已列出
  `BFF_HOST_PORT`（引用自 SDLCCT-57），本票不新增/變更任何環境變數，
  只調整 Caddyfile 內部路由與 `NEXT_PUBLIC_BFF_URL` 的建議值文字，
  RUNBOOK 既有步驟（建立 `.env`、`docker compose build/up`、套用
  Caddyfile）不需要任何新增步驟。

結論：AC7「Opik 曝露面零變更、`OPIK-EXPOSURE-CHECKLIST.md` 不需要
改動」在實際核對兩份文件文字後確認成立，非預先假設。

## UI 原型

無，本 Story 不涉及前端 UI 畫面變更（純反向代理路由設定 + 設計文件
交叉引用修正，不新增/調整任何畫面元件，`frontend/lib/api-client.ts`
本身不改）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰前端
元件/CSS，`deploy/Caddyfile.template` 與 `docs/design/SDLCCT-57.md`
皆非前端程式碼），`Grep` 檢查略過。

## AC 對應表

| AC | 對應設計決策 |
|---|---|
| AC1：同一 site block 下新增路徑式 BFF 路由，其餘路徑仍導向 frontend，無新 site block/port | 「介面/API 契約」兩個 `handle {}` 區塊；關鍵決策 #2 |
| AC2：路徑前綴為字面值（非 `<佔位符>`），附註解說明為何是字面值 | `handle /api/*` 上方的註解區塊（解釋路徑非主機特定值） |
| AC3：修法後對外僅開放 443；BFF host port 保持 localhost 綁定，只透過 Caddy 內部 hop | `reverse_proxy localhost:<BFF_HOST_PORT>`（無新 port 對外發布）；關鍵決策 #3 核實 checklist 第 3 節既有泛稱判準已涵蓋 |
| AC4：瀏覽器透過同一公開網域+port 呼叫 BFF；`NEXT_PUBLIC_BFF_URL` 設為同源值，同源即無 CORS 問題 | SDLCCT-57.md 建議值修正為 `https://<PUBLIC_DOMAIN>`；關鍵決策 #1 |
| AC5：不需要改動 `fetchJson()`/前端程式碼，其字串串接本來就相容 | 關鍵決策 #1（裸 origin + `/api/*` 原樣轉送，與既有 `path` 參數已含 `/api/` 前綴逐字對齊，零改寫） |
| AC6：修正 `docs/design/SDLCCT-57.md` 的 `NEXT_PUBLIC_BFF_URL` 建議值文字，僅交叉引用、不重寫其他章節 | 「介面/API 契約」SDLCCT-57.md 修正段落（唯一改動的一行表格） |
| AC7：Opik 零曝露，不碰其 INFORMATIONAL 註解區塊，`OPIK-EXPOSURE-CHECKLIST.md` 不需改動 | 關鍵決策 #3（逐一核實兩份文件現有文字） |

## 開放設計問題（定稿時必須為空）

（無）
