# 設計文件 — SDLCCT-39 抽出共用前端 API client（fetch/錯誤處理）

## 對應需求規格
對應 G1 已核准的需求規格。使用者故事：身為負責後續 5 個畫面開發的工程師，
希望 `fetchJson`/`ApiError`/`BFF_BASE_URL` 等畫面無關的邏輯被抽出成獨立
共用模組，之後調整錯誤處理方式只需改一處。5 條 Gherkin AC：(1) 存在新的
共用模組匯出三者，且不再定義於 `cost-overview-api.ts`；(2)
`cost-overview-api.ts` 僅保留成本儀表板專屬型別與
`fetchCostOverviewSummary()`/`fetchPeriodComparison()`，底層呼叫共用模組的
`fetchJson`；(3) 4 個既有呼叫點（`use-fetch-once.ts`、`error-card.tsx`、
`summary-section.tsx`、`period-comparison-section.tsx`）更新 import 路徑後
build/type-check 成功，既有單元測試與 e2e 測試不改測試檔內容即全部通過；
(4) SDLCCT-32 的 per-card 錯誤隔離行為位元組不變；(5) `ApiError` 的
`endpoint`/`status`/`message` 欄位值與重構前完全一致。範圍外：不改變 API
請求/回應邏輯、不新增 retry/timeout/cache、不變更 `BFF_BASE_URL` 的
fail-fast 驗證規則本身、不改變對外函式簽名。純內部檔案結構重構，不是產品
行為變更。

## 介面/API 契約
不適用。本票不新增/變更任何對外 HTTP 端點或 request/response 格式——這是
前端內部模組邊界的重構，`bff/` 完全不受影響。

## 資料模型
無新增資料模型。本票不觸及任何資料表/欄位/索引，也不觸及任何持久化或
序列化結構；`ApiError`/`CostOverviewSummary`/`PeriodComparison` 等既有
TypeScript interface 的欄位與型別維持逐字不變（只是定義所在的檔案改變，
`ApiError` 搬到新模組，其餘兩個 response 型別留在
`cost-overview-api.ts`，因為它們是成本儀表板專屬資料形狀，不是「畫面無關」
的共用邏輯——AC2 明文只要求搬 `fetchJson`/`ApiError`/`BFF_BASE_URL`）。

## 現狀盤點：跨元素樣式一致性測試（依流程步驟 4 檢查）
已對 `frontend/` 全目錄搜尋 `toEqual`/`getComputedStyle`/「一致」等跨元素
computed-style 比較斷言——唯一命中是 `frontend/AGENTS.md`（文件說明文字，
非測試斷言）。`frontend/e2e/` 下現有測試（`cost-dashboard.spec.ts`、
`i18n-cost-dashboard-strings.spec.ts`）皆只斷言文字可見性/標題，不比較任何
兩個元素的 computed style。本票也不改變任何 CSS/class/視覺輸出（純邏輯檔案
搬移），故不存在需要擔心的既有跨元素樣式耦合測試鏈，也不會新建這類耦合。

## 關鍵技術決策

1. **新模組命名與路徑：`frontend/lib/api-client.ts`（確認 ticket 建議，不
   override）。**
   與既有 `frontend/lib/` 下按職責命名的既有檔案（`format.ts`、
   `use-fetch-once.ts`）風格一致；`api-client` 直接反映它的職責——通用的
   BFF HTTP client 基礎設施（base URL 解析 + fetch 包裝 + 錯誤正規化），
   不含任何畫面專屬型別，讓後續 5 個畫面的 API 模組（例如未來的
   `agent-list-api.ts`）都能 import 同一個檔案，不需要重新發明。

2. **`ApiError` 改為 2 個呼叫點（`use-fetch-once.ts`、`error-card.tsx`）
   直接從 `@/lib/api-client` import，`cost-overview-api.ts` 不做
   re-export shim——確認 requirements-analyst 的建議，不 override。**
   理由：只有 4 個呼叫點、2 個涉及 `ApiError`，改動成本是把 import 來源
   字串換成新路徑，單次性的機械改動；re-export shim
   （`export type { ApiError } from "./api-client"`）只會多一層間接層，
   讓之後任何人讀 `cost-overview-api.ts` 時多一個「這個型別其實定義在別處」
   的認知負擔，且與本票目標（讓錯誤處理邏輯集中在一處、不是分散出兩個來源）
   方向相反。`fetchCostOverviewSummary`/`fetchPeriodComparison` 的呼叫點
   （`summary-section.tsx`、`period-comparison-section.tsx`）本來就只 import
   這兩個函式，不 import `ApiError`，不受此決策影響。

3. **不做循環 import 檢查之外的額外保護機制（例如 barrel file）——
   `frontend/lib/api-client.ts` 不 import `cost-overview-api.ts` 的任何
   東西，依賴方向單向：`cost-overview-api.ts` → `api-client.ts`。**
   確認無循環風險：`api-client.ts` 只包含與畫面無關的基礎設施
   （`BFF_BASE_URL`、`ApiError`、`fetchJson`），不需要知道任何成本儀表板
   專屬型別或函式；`cost-overview-api.ts` 的兩個函式呼叫
   `api-client.ts` 匯出的 `fetchJson`，依賴方向永遠是「畫面專屬模組依賴
   共用模組」，不會反向。

4. **`fetchJson` 維持泛型函式簽名 `fetchJson<T>(path: string):
   Promise<T>`，搬移時不變更簽名、不變更內部實作（錯誤正規化、
   `response.ok` 判斷、JSON parse fallback 邏輯逐字搬移）——對應 AC5
   「ApiError 欄位值與重構前完全一致」與範圍外「不改變對外函式簽名」。**
   這是純粹的檔案搬移（move），不是重寫；唯一的程式碼差異應該只是檔案
   位置與 import 陳述句，讓既有單元測試/e2e 測試不需要修改任何斷言內容
   即可通過（AC3）。

### Before / After 程式碼骨架

**新檔案 `frontend/lib/api-client.ts`**（從 `cost-overview-api.ts` 搬出，
邏輯逐字不變）：
```ts
// Shared BFF HTTP client: base URL resolution, fetch wrapper, and error
// normalization. Screen-agnostic — do not add any cost-overview-specific
// (or any other screen-specific) type or function here (SDLCCT-39).

if (!process.env.NEXT_PUBLIC_BFF_URL) {
  throw new Error("NEXT_PUBLIC_BFF_URL is not set");
}

export const BFF_BASE_URL = process.env.NEXT_PUBLIC_BFF_URL;

export interface ApiError {
  endpoint: string;
  status: number;
  message: string;
}

export async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BFF_BASE_URL}${path}`);
  } catch (cause) {
    const err: ApiError = {
      endpoint: path,
      status: 0,
      message: cause instanceof Error ? cause.message : "network error",
    };
    throw err;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
    } catch {
      // body wasn't JSON -- keep the generic message, never blank.
    }
    const err: ApiError = { endpoint: path, status: response.status, message };
    throw err;
  }

  return (await response.json()) as T;
}
```
註：`fetchJson` 從 module-private 函式改為 `export`（原本在
`cost-overview-api.ts` 內未匯出，因為只有同檔案內的兩個函式呼叫它；現在
`cost-overview-api.ts` 需要從外部呼叫它，故必須匯出）——這是搬移產生的
必然結果，不是額外新增的對外介面擴張。

**`frontend/lib/cost-overview-api.ts`（重構後，僅保留成本儀表板專屬邏輯）：**
```ts
// Client for the bff's Cost overview screen endpoints (SDLCCT-32).
// See docs/design/SDLCCT-32.md "介面/API 契約" for the exact response
// shapes this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) — this file holds only this screen's
// types and endpoint functions.

import { fetchJson } from "@/lib/api-client";

export interface UnregisteredAgentSpend {
  key: string;
  display: string;
  spend: number;
}

export interface CostOverviewSummary {
  anchor_date: string;
  month_start: string;
  days_elapsed: number;
  days_in_month: number;
  total_spend: number;
  total_budget: number;
  budget_consumed_pct: number | null;
  projected_month_end_spend: number | null;
  projected_overspend: number | null;
  unregistered: {
    spend: number;
    agents: UnregisteredAgentSpend[];
  };
}

export interface PeriodComparisonAgent {
  key: string;
  display: string;
  current_cost: number;
  previous_cost: number;
  delta: number;
  delta_pct: number | null;
}

export interface PeriodComparison {
  anchor_date: string;
  current_period: { start: string; end: string };
  previous_period: { start: string; end: string };
  agents: PeriodComparisonAgent[];
}

export function fetchCostOverviewSummary(): Promise<CostOverviewSummary> {
  return fetchJson<CostOverviewSummary>("/api/cost-overview/summary");
}

export function fetchPeriodComparison(): Promise<PeriodComparison> {
  return fetchJson<PeriodComparison>("/api/cost-overview/period-comparison");
}
```
註：`BFF_BASE_URL` 不再被 `cost-overview-api.ts` 參照（它原本只在
`fetchJson` 內部使用），搬移後不需要在此檔案 import 或 re-export它。

**呼叫點 import 路徑更動（僅改 import 陳述句，其餘程式碼不變）：**

`frontend/lib/use-fetch-once.ts`：
```ts
// before
import type { ApiError } from "@/lib/cost-overview-api";
// after
import type { ApiError } from "@/lib/api-client";
```

`frontend/components/cost-overview/error-card.tsx`：
```ts
// before
import type { ApiError } from "@/lib/cost-overview-api";
// after
import type { ApiError } from "@/lib/api-client";
```

`frontend/components/cost-overview/summary-section.tsx`、
`frontend/components/cost-overview/period-comparison-section.tsx`：
不變——兩者 import `fetchCostOverviewSummary`/`fetchPeriodComparison`，
這兩個函式維持定義在 `@/lib/cost-overview-api`，故 import 路徑不需要改動。
（spec 的 AC3 列出全部 4 個檔案需要「更新 import 路徑」，但實際盤點後只有
2 個檔案的 import 路徑真的需要改字串——`summary-section.tsx`/
`period-comparison-section.tsx` 的既有 import 在重構後仍然正確，developer
階段仍應確認這兩個檔案 build 通過，但不需要修改其 import 陳述句本身。）

## UI 原型
無，本故事不涉及前端 UI 外觀或互動變更。這是純內部模組邊界重構（搬移
`fetchJson`/`ApiError`/`BFF_BASE_URL` 到新檔案，不改任何元件的 JSX/
className/渲染輸出），AC3 要求「既有單元測試與 e2e 測試在不修改測試檔案
內容的前提下全部通過」即是本故事「視覺與行為完全不變」的驗證依據，不需要
另外產生原型給人類在 G1b 審核視覺結果。

## 開放設計問題（定稿時必須為空）
無——規格與既有程式碼已足以決定本票所有 HOW 層級的選擇（新模組名稱/路徑、
re-export vs 直接 import 的取捨、搬移範圍邊界、4 個呼叫點各自是否需要改動
import 路徑），且未發現既有跨元素樣式一致性測試鏈需要處理。
