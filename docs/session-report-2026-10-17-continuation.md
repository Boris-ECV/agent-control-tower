# Session 報告 — 2026-10-17（續） orch-20261016-k3f9

> 延續 2026-10-17 的同一 session，承接 `docs/session-report-2026-10-17.md`（SDLCCT-9/10 完成後產出）之後的所有後續工作。本報告涵蓋 SDLCCT-11、15、16、17、18、19、20、21、22。

## 本次進度
| 工單 | 起始狀態 → 結束狀態 | 備註 |
|------|----------------------|------|
| SDLCCT-11 Caching layer for Opik queries | Backlog → **Done** | 範圍窄化為只快取 SDLCCT-10 的 `get_project_metrics()`（其餘端點家族當時尚未存在）。新增通用 `bff/cache.py::TTLCache`，`get_project_metrics_cached()` 的快取讀/寫失敗各自隔離、backend 例外完全不被攔截直接往外傳。零 reopen。PR #38 合併。 |
| SDLCCT-15 Opik read client: workspace/project 摘要端點 | Backlog → **Done** | 原三端點草案中 `/projects/{id}/kpi-cards` 查無任何已驗證形狀，拆出 SDLCCT-18。保留 `/workspaces/costs`（後端原生依 project_ids 過濾）與 `/projects/stats`（後端無過濾參數，用戶端 `set()` 交集過濾為 AC 本身）。新增 `bff/opik_workspace.py`。零 reopen。PR #42 合併。 |
| SDLCCT-16 Opik read client: /spans/stats + 依模型拆分成本 | Backlog → **Blocked** | `/spans/stats` 全 repo 查無已驗證形狀；同時發現「依模型拆分成本」可能已被 SDLCCT-10 的 tags-breakdown 滿足——這是產品範圍決策，不是工程判斷，開 HUMAN-INPUT **SDLCCT-19** 請人類決定是否整票取消/縮減/延後。 |
| SDLCCT-17 Opik read client: trace 搜尋端點（依成本排序） | Backlog → **Done** | 原票含「依 metadata 篩選」，查無已驗證請求參數形狀，拆出 SDLCCT-20，保留已驗證的「依 total_estimated_cost 排序」。設計明確決定 trace 樹組裝完全不放本模組（4 條 AC 僅要求 flat 清單）。新增 `bff/opik_traces.py`。完整走完 Refining→G1→Designing→G1b→Ready→In Progress→Testing→In Review→G2→Done，零 reopen。PR #44-47（PRD/設計文件/實作/metrics）全部合併。 |
| SDLCCT-18 Opik read client: /projects/{id}/kpi-cards | Backlog → **Blocked** | requirements-analyst 二次獨立全 repo 搜尋，確認與 SDLCCT-15 原結論一致：無任何已驗證形狀證據，也無隱藏別名呼叫。開 HUMAN-INPUT **SDLCCT-21**。 |
| SDLCCT-20 Opik read client: trace 搜尋依 metadata 篩選 | Backlog → **Blocked** | requirements-analyst 確認 `/v1/private/traces` 端點本身存在且可用，但 metadata 篩選請求參數從未被驗證過；確認 SDLCCT-10 的 `/metrics` breakdown.metadata_key 是不同資源/語意，不可借用。開 HUMAN-INPUT **SDLCCT-22**。 |
| SDLCCT-19/21/22（新建 HUMAN-INPUT） | — → Backlog | 三張工單皆已依新規則在**標題**加 `[HUMAN-INPUT]` 前綴，分別 Blocks-link 至 SDLCCT-16/18/20，各附具體問題與已考慮的選項、agent 建議。 |

## 等待你的動作 ⚠️
- **待放行 gate**：無
- **HUMAN-INPUT 待回答**（本次新增，需逐一確認 Jira 留言，不要只看 status）：
  - **SDLCCT-19**：SDLCCT-16 是否因 SDLCCT-10 的 tags-breakdown 已滿足「依模型拆分成本」而取消/縮減/延後？
  - **SDLCCT-21**：`/projects/{id}/kpi-cards` 端點形狀——提供 API 文件、授權一次性探測真實後端，或關閉 SDLCCT-18？
  - **SDLCCT-22**：trace 搜尋 metadata 篩選參數形狀——提供 API 文件、無限期延後，或關閉 SDLCCT-20？
- **需要人工 review 的 PR**（延續自前一份報告，皆未變動，仍待審核）：
  - PR #24「HUMAN-INPUT 工單標題需加 `[HUMAN-INPUT]` 前綴」——觸及 `templates/`、`docs/02`。
  - PR #32「project-profile.yaml 補上 BFF 技術棧決定」——觸及 `project-profile.yaml`。

## 紅色區 🔴
- Blocked > 3 天：無（SDLCCT-16/18/20 皆剛於本 session 內轉為 Blocked）
- Reopen ≥ 3（已 escalation）：無（SDLCCT-11/15/17 全部零 reopen；SDLCCT-10 累計 1 次，未達門檻）
- Silent failure 檢查：0（每次 PR 合併前皆以 `gh pr checks`/`gh run watch` 確認實際 CI 綠燈，而非只信任本地 pytest）

## 資源使用
- Token 用量估計：高（本段落完整處理 3 張 Story 全流程 Done、2 張技術性拆票、2 張並行 requirements-analyst 驗證嘗試、3 張新建 HUMAN-INPUT）
- 高階模型（premium tier）使用：0 次 / 週上限 5
- Rate limit 事件：1 次（usage limit 於前段耗盡後重置，已於重置後依系統指示無聲繼續，未另行告知使用者）

## 下個 session 建議起點
1. 先確認 SDLCCT-19/21/22 是否已被人類回答（**務必重新讀取各工單的留言串**，不要只看 status——board 層級查詢無法分辨「仍在等回答」與「已回答但尚未被 orchestrator 處理」）。
2. PR #7、#24、#32 仍全部待人工審核，皆因觸及受保護路徑正確保持未合併。
3. 目前 Backlog 中已無其他可由 orchestrator 單方面推進的工作——SDLCCT-16/18/20 全部卡在上述三張 HUMAN-INPUT；SDLCCT-1/3/4/5/6（E1/E3/E4/E5/E6）仍是空的 Epic，尚無任何 Story 可供精煉。
