# Opik 公開曝露收斂檢查清單（人類執行）

## 0. 使用前提

- **本清單只做檢查，不執行任何變更**。發現任一項目 FAIL 時，應立即
  通報並停止上線宣告，不得自行修改任何設定（範圍外界線，本清單本身
  不負責修正，只負責判定）。
- 執行者：人類維運人員。AI 不得代為執行本清單的任何項目，也不得連線
  主機進行任何檢查（沿用 SDLCCT-57/58/59 已確立的 E6 epic 限制）。
- 執行時機：待 SDLCCT-58 的 `deploy/Caddyfile.template` 依
  SDLCCT-59 `deploy/RUNBOOK.md`（部署 runbook）套用到主機之後，可隨時
  重複執行本清單作稽核（與 RUNBOOK 的一次性部署驗證不同用途——本清單設計為上線後
  可反覆執行的獨立稽核工具，例如定期複查、換人接手維運時的快速
  上手文件）。
- 佔位符總表（沿用 SDLCCT-58 的三個佔位符，人類執行時以自己持有的
  真實值代入下列檢查指令中，**不得**把真實值寫回本文件或任何 repo
  檔案）：
  - `<PUBLIC_DOMAIN>`：對外公開網域。
  - `<PORTAL_PUBLIC_PORT>`：Portal 前端容器在主機上發布的 port。
  - `<OPIK_INTERNAL_PORT>`：Opik 前端/API 僅供主機內部呼叫者使用的
    port。

## 1. 檢查項目一 — Opik 原始前端不可直接存取

**如何檢查**：從瀏覽器或 `curl -I https://<PUBLIC_DOMAIN>/` 以及 Opik
已知的前端路徑（具體路徑由人類依 Opik 實際介面決定，本清單不臆測
Opik 介面細節）存取公開網域，觀察回應內容；同時比對主機上實際套用的
Caddyfile（依 SDLCCT-58 `deploy/Caddyfile.template` 套用後的結果）：
確認其中沒有任何對外 site block 的 `reverse_proxy` 指向 Opik 的內部
位址（即 `<OPIK_INTERNAL_PORT>` 對應的真實值）。

**PASS 代表**：公開網域的所有回應皆為 Portal 畫面或 Caddy 預設/404
頁，且主機 Caddyfile 中找不到任何把公開網域導向 Opik 內部位址的
site block。

**FAIL 代表**：公開網域任一路徑回應可辨識為 Opik 前端介面的內容
（例如 Opik 的登入畫面、Opik 特有的版面元素），或主機 Caddyfile 中
存在任何把對外網域導向 Opik 內部位址的 site block（即便目前標示
「暫停使用」也算 FAIL——存在即是曝露面）。

## 2. 檢查項目二 — Opik API 路徑不可被公開直接呼叫

**如何檢查**：以 `curl` 從公開網域嘗試呼叫 Opik 已知 API 路徑（具體
路徑由人類依 Opik 實際 API 決定，不臆測），觀察回應；同時對照 BFF
連線 Opik 的方式：檢視 SDLCCT-57 的 `OPIK_BASE_URL` 環境變數實際值，
確認其為主機內部位址（loopback/internal interface），而不是
`<PUBLIC_DOMAIN>`，據此確認 BFF 與 Opik 之間的呼叫全程只透過主機
內部連線完成，從未經過對外網域的 Caddy site block。

**PASS 代表**：公開網域呼叫 Opik API 路徑得到連線失敗、404，或被
導向 Portal 內容（三者皆算通過，判準概念與 SDLCCT-59
`deploy/RUNBOOK.md` 第 4 節「驗證步驟 B」一致——兩份文件描述同一件事：
Opik 是否曝露在公開網域，以避免各自定義不一致；差異只在於 Caddy
層是否認得該路徑，不是「Opik 有沒有回應」），且 `OPIK_BASE_URL` 的
實際值可確認是主機內部位址而非公開網域。

**FAIL 代表**：公開網域直接回應可辨識為 Opik API 的內容（例如 Opik
特有的 JSON 錯誤格式、版本號字串），或 `OPIK_BASE_URL` 的實際值等於
/經由 `<PUBLIC_DOMAIN>`（代表 BFF 連線 Opik 繞經了公開網域，違反
「僅能透過 BFF 內部連線完成」的要求）。

## 3. 檢查項目三 — 對外僅開放 443（HANDOFF 14.1）

**如何檢查**：在主機上對公開網域/公開 IP 執行連接埠掃描（例如
`nmap` 對外掃描，或主機既有慣用工具，具體指令由人類依主機實況決定，
本清單不臆測主機工具），確認從外部僅 443 可成功連線；80 僅允許
Caddy 自動 HTTPS 既有的 ACME challenge/重定向用途（既有機制，非本票
新開放），不視為額外曝露面。本項判準對應 HANDOFF 架構原則 14.1 節
「對外僅開放必要連接埠」的要求（HANDOFF 文件本身不在本 repo 中，
人類執行時以自己持有的 HANDOFF 文件實際條文為準，本清單不複製其
內容，只引用其章節號作為出處）。

**PASS 代表**：從公開網域/公開 IP 掃描，僅 443（及 Caddy 自動 HTTPS
既有機制所需的 80）可連線成功；其餘所有 port——包含
`<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>` 對應的真實值，以及
Opik/Portal 容器各自發布的任何 host port——從外部連線皆逾時或被拒絕。

**FAIL 代表**：從公開網域/公開 IP 掃描，發現任何非 443/80 的 port
可被外部直接連線成功，尤其是 Opik 或 Portal 容器直接發布的 host
port（即便該 port 回應的內容看起來「正常」，只要外部可連線即視為
FAIL，因為本項檢查的是曝露面本身，不是曝露後的內容）。

## 4. 總結判定

- 三個檢查項目全部 PASS，才判定整體 PASS；任一項 FAIL，整體判定為
  FAIL。
- FAIL 時：不得判定為「暫時沒注意到／看起來不影響」就放行，必須
  回報並中止上線宣告（引用 CONSTITUTION「deny-by-default for
  anything that mutates infrastructure」與「No new network exposure
  without a ticket」的精神——本清單存在的目的正是把這兩條原則變成
  可逐項核對的動作）。
