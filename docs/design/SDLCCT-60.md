# 設計文件 — SDLCCT-60 Checklist: close off Opik's direct public exposure

## 對應需求規格

對應 G1 已核准的需求規格「Checklist: close off Opik's direct public
exposure」：產出一份**獨立的**檢查清單文件，列出 Portal 上線後必須
確認「Opik 不再被公開網域直接存取」的所有檢查項目，每項目皆含「如何
檢查」「PASS 代表什麼」「FAIL 代表什麼」三要素的具體判準。5 條 AC
對應範圍：

1. 「Opik 原始前端不可直接存取」項目，含具體 PASS/FAIL 樣貌。
2. 「Opik API 路徑不可被公開直接呼叫」項目，含具體 PASS/FAIL 樣貌，
   並註明應僅能透過 BFF 內部連線完成。
3. 「對外僅開放 443」項目，引用 HANDOFF 14.1，含具體 PASS/FAIL 樣貌。
4. 每個檢查項目都同時包含三要素，不存在只寫「確認是否正常」而未定義
   具體樣貌的項目。
5. 文件無真實主機位址/IP，全文繁體中文。

本票的交付物是文件本身（由開發階段撰寫），**不是**程式碼；本設計
文件的任務是把這份清單的章節結構、三個檢查項目各自的「如何檢查/PASS/
FAIL」具體措辭定案，讓開發階段不需要自己發明判準。

**本文件是獨立的標準文件**（spec 範圍外明文：不是 SDLCCT-58 本身的
撰寫/修改，也——依本次任務指示——不是 SDLCCT-59 `deploy/RUNBOOK.md`
的一節）。理由見下方關鍵技術決策 #1。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：不執行清單裡任何
項目（架構師與開發者皆不連線主機、不執行任何檢查指令）；不包含實際
防火牆/網路設定變更；不重複/修改 SDLCCT-58 本身內容（只讀取、對照其
範本「實際改了什麼」撰寫本清單項目）。

依賴：
- SDLCCT-58（`docs/design/SDLCCT-58.md`）：範本檔案
  `deploy/Caddyfile.template`，佔位符 `<PUBLIC_DOMAIN>`、
  `<PORTAL_PUBLIC_PORT>`、`<OPIK_INTERNAL_PORT>`——本清單的檢查項目
  必須對照該範本「單一對外 site block 只導向 Portal、Opik 連線方式
  僅為 INFORMATIONAL 註解、Opik 完全沒有對外 site block」這個既定
  結構撰寫，不得臆測範本以外的內容。
- SDLCCT-57（`docs/design/SDLCCT-57.md`）：BFF 環境變數
  `OPIK_BASE_URL`（BFF 連線 Opik 的位址，供第二項檢查對照）。
- SDLCCT-59（`docs/design/SDLCCT-59.md`）第 4 節「驗證步驟 B」：已對
  「Opik 不再對外可存取」建立過一套 PASS/FAIL 語言，本清單第一、
  二項的判準措辭延續該既有語言，避免兩份文件對同一件事給出不一致的
  定義（見下方關鍵技術決策 #2）。
- HANDOFF（人類持有的主機操作/架構交接文件，不在本 repo 中）第 14.1
  節：本清單第三項引用其章節號作為「對外僅開放必要連接埠」原則的
  出處，不複製其內容（見下方「無法從 repo 內容驗證的事實」）。

**無法從 repo 內容驗證的事實**：HANDOFF 文件第 14.1 節的實際文字、
主機上目前對外實際開放的連接埠清單，都只存在於人類自己持有的主機
操作紀錄與 HANDOFF 文件中，不在本 repo，也不得連線主機讀取或臆測其
具體內容（延續 SDLCCT-57/58/59 設計文件已確立的同一類限制）。本文件
提及 HANDOFF 14.1 時，僅引用其章節號作為判準出處，不杜撰其條文文字。

## 介面/API 契約

無對外 HTTP 介面變更。本票的「契約」是**檢查清單文件本身的結構**——
交付物是 `deploy/OPIK-EXPOSURE-CHECKLIST.md`（新增，與
`deploy/Caddyfile.template`、`deploy/docker-compose.portal.yml`、
`deploy/RUNBOOK.md` 同目錄，理由見下方關鍵決策 #1），開發階段必須
依下列章節順序撰寫，不得自行增減頂層章節：

```
# Opik 公開曝露收斂檢查清單（人類執行）

## 0. 使用前提
## 1. 檢查項目一 — Opik 原始前端不可直接存取
## 2. 檢查項目二 — Opik API 路徑不可被公開直接呼叫
## 3. 檢查項目三 — 對外僅開放 443（HANDOFF 14.1）
## 4. 總結判定
```

### 第 0 節「使用前提」必須包含
- 一句明確聲明：本清單只做**檢查**，不執行任何變更；發現 FAIL 時
  通報並停止上線宣告，不得自行修改任何設定（範圍外界線）。
- 執行者：人類維運人員；AI 不得代為執行任何項目（沿用
  SDLCCT-57/58/59 已確立的 E6 epic 限制）。
- 執行時機：SDLCCT-58 的 `deploy/Caddyfile.template` 已依
  SDLCCT-59 `deploy/RUNBOOK.md` 套用到主機之後，可隨時重複執行本
  清單作稽核（與 RUNBOOK 的一次性部署驗證不同用途，見關鍵決策 #1）。
- 佔位符總表：沿用 SDLCCT-58 的三個佔位符
  `<PUBLIC_DOMAIN>`／`<PORTAL_PUBLIC_PORT>`／`<OPIK_INTERNAL_PORT>`，
  人類執行時以自己持有的真實值代入檢查指令中，**不得**把真實值寫回
  本文件或任何 repo 檔案。

### 第 1 節「檢查項目一 — Opik 原始前端不可直接存取」（AC1）必須包含
**如何檢查**：從瀏覽器或 `curl -I https://<PUBLIC_DOMAIN>/` 以及 Opik
已知的前端路徑（具體路徑由人類依 Opik 實際介面決定，本設計不臆測
Opik 介面細節，同 SDLCCT-59 決策 #5 的既有限制）存取公開網域，觀察
回應內容；同時比對主機上實際套用的 Caddyfile（依 SDLCCT-58
`deploy/Caddyfile.template` 套用後的結果）：確認其中沒有任何對外
site block 的 `reverse_proxy` 指向 Opik 的內部位址（即
`<OPIK_INTERNAL_PORT>` 對應的真實值）。

**PASS 代表**：公開網域的所有回應皆為 Portal 畫面或 Caddy 預設/404
頁，且主機 Caddyfile 中找不到任何把公開網域導向 Opik 內部位址的
site block。

**FAIL 代表**：公開網域任一路徑回應可辨識為 Opik 前端介面的內容
（例如 Opik 的登入畫面、Opik 特有的版面元素），或主機 Caddyfile 中
存在任何把對外網域導向 Opik 內部位址的 site block（即便目前標示
「暫停使用」也算 FAIL——存在即是曝露面）。

### 第 2 節「檢查項目二 — Opik API 路徑不可被公開直接呼叫」（AC2）必須包含
**如何檢查**：以 `curl` 從公開網域嘗試呼叫 Opik 已知 API 路徑（具體
路徑由人類依 Opik 實際 API 決定，不臆測），觀察回應；同時對照 BFF
連線 Opik 的方式：檢視 SDLCCT-57 的 `OPIK_BASE_URL` 環境變數實際
值，確認其為主機內部位址（loopback/internal interface），而不是
`<PUBLIC_DOMAIN>`，據此確認 BFF 與 Opik 之間的呼叫全程只透過主機
內部連線完成，從未經過對外網域的 Caddy site block。

**PASS 代表**：公開網域呼叫 Opik API 路徑得到連線失敗、404，或被
導向 Portal 內容（三者皆算通過，判準同 SDLCCT-59 第 4 節「驗證步驟
B」——差異只在於 Caddy 層是否認得該路徑，不是「Opik 有沒有回應」），
且 `OPIK_BASE_URL` 的實際值可確認是主機內部位址而非公開網域。

**FAIL 代表**：公開網域直接回應可辨識為 Opik API 的內容（例如 Opik
特有的 JSON 錯誤格式、版本號字串），或 `OPIK_BASE_URL` 的實際值等於
/經由 `<PUBLIC_DOMAIN>`（代表 BFF 連線 Opik 繞經了公開網域，違反
「僅能透過 BFF 內部連線完成」的要求）。

### 第 3 節「檢查項目三 — 對外僅開放 443」（AC3，HANDOFF 14.1）必須包含
**如何檢查**：在主機上對公開網域/公開 IP 執行連接埠掃描（例如
`nmap` 對外掃描，或主機既有慣用工具，具體指令由人類依主機實況決定，
本設計不臆測主機工具），確認從外部僅 443 可成功連線；80 僅允許
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

### 第 4 節「總結判定」必須包含
- 三個檢查項目全部 PASS，才判定整體 PASS；任一項 FAIL，整體判定為
  FAIL。
- FAIL 時：不得判定為「暫時沒注意到／看起來不影響」就放行，必須
  回報並中止上線宣告（引用 CONSTITUTION「deny-by-default for
  anything that mutates infrastructure」與「No new network exposure
  without a ticket」的精神——本清單存在的目的正是把這兩條原則變成
  可逐項核對的動作）。

## 資料模型

無新增資料模型。無新增/變更任何資料表、欄位、索引（本票為純文件
交付物，不涉及應用程式資料或任何既有資料模型，例如
`seed/out/manifest.json`，皆無關）。

## 關鍵技術決策

### 1. 獨立成 `deploy/OPIK-EXPOSURE-CHECKLIST.md`，不併入 `deploy/RUNBOOK.md`

Spec 範圍外已明文「不含 SDLCCT-58 本身的撰寫/修改」，而本次任務指示
進一步確認本票的檢查清單是**獨立文件**，不是 SDLCCT-59 RUNBOOK 的
一節。理由：RUNBOOK 第 4 節「驗證步驟 B」是部署流程中**一次性**的
驗證步驟，執行完即進入下一步；本清單設計為可在上線後**重複執行**的
獨立稽核工具（例如定期複查、換人接手維運時的快速上手文件），兩者
使用情境與生命週期不同，合併會讓稽核人員被迫翻閱整份部署流程才能
找到想要的檢查項目。檔案位置沿用 SDLCCT-57/58/59 已確立的分工
（交付物在 `deploy/`，設計文件在 `docs/design/`），放在
`deploy/RUNBOOK.md` 同目錄，方便人類在同一資料夾內交叉參照佔位符
名稱。

### 2. 第一、二項的 PASS/FAIL 措辭延續 SDLCCT-59 第 4 節既有語言，不重新發明

SDLCCT-59 的「驗證步驟 B」已經為「Opik 不再對外可存取」建立過一套
判準（連線失敗/被導向 Portal 皆算通過，可辨識 Opik 內容才算失敗）。
兩份文件描述的是同一個底層事實（Opik 是否曝露在公開網域），若各自
發明不同措辭，日後其中一份修改判準時容易漏改另一份，造成兩份文件
對「怎樣算通過」互相矛盾。本清單直接延續既有措辭，僅補上 RUNBOOK
沒有的「對照 Caddyfile 實際內容」與「對照 `OPIK_BASE_URL`」這兩個
本清單獨有的補充檢查動作。

### 3. 新增第三項「僅開放 443」，直接引用 HANDOFF 14.1 章節號，不複製其條文

RUNBOOK（SDLCCT-59）沒有這一條，是本票獨有的範圍。HANDOFF 文件不在
本 repo 中（見上方「無法從 repo 內容驗證的事實」），本清單僅引用其
章節號作為判準出處，不杜撰其具體條文——與 SDLCCT-57/58/59 設計文件
處理「無法驗證的主機事實」的既有模式一致。

### 4. 具體檢查指令（Opik 路徑、掃描工具）不臆測，留給開發階段依人類既有知識填入

AC1-AC3 要求「具體 PASS/FAIL 樣貌」，但不要求本設計杜撰 Opik 介面
細節或主機慣用的掃描工具——這些都是 SDLCCT-58 範圍之外、架構師/
開發者皆不得連線主機驗證的事實。本設計已把能從 spec/既有產出物確定
的部分定案（章節順序、三要素結構、判準語言、對照哪些既有佔位符/
環境變數），指令層級的細節（例如確切的 `curl` 路徑、用 `nmap` 還是
其他掃描工具）留給開發階段寫成「範例指令 + 註記由人類依主機與 Opik
實際情況調整」的形式——同 SDLCCT-59 決策 #5 的既有限制，一致處理，
不是規格缺口。

## UI 原型

無，本 Story 不涉及前端 UI 畫面變更（純文件交付物）。

## 跨元素樣式耦合測試檢查

不適用：本票不變更任何既有 selector 的 computed style（不觸碰前端
元件/CSS 或任何程式碼），`Grep` 檢查略過。

## 開放設計問題

（無）
