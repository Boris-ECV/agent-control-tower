# 設計文件 — SDLCCT-38 從 BFF OpenAPI schema 產生前端 TypeScript 型別

## 對應需求規格
對應 G1 已核准的需求規格：`frontend/lib/cost-overview-api.ts` 目前手寫
`CostOverviewSummary`/`PeriodComparison`/`UnregisteredAgentSpend`/
`PeriodComparisonAgent` 四個回應型別，本票改為從 BFF（FastAPI）的
OpenAPI schema 自動產生 TypeScript 型別取代它們，涵蓋
`/api/cost-overview/summary` 與 `/api/cost-overview/period-comparison`
兩個端點目前的回應形狀；產生流程可重複執行且冪等；
`fetchCostOverviewSummary()`/`fetchPeriodComparison()` 的函式簽名、請求
路徑、錯誤處理邏輯不變，既有單元/e2e 測試維持通過；產生出來的檔案有
「自動產生、請勿手動編輯」標記且不受一般手寫程式碼 lint 規則約束；新增
的指令整理進 `frontend/package.json`/`project-profile.yaml` 既有命名慣例；
不新增/調整任何 BFF 端點的請求/回應邏輯，不加入任何執行期 schema 驗證。

**已確認的背景（不重新調查）**：`.github/workflows/ci.yml` 的 `bff`/
`frontend` 兩個 job 都沒有啟動 BFF server、`frontend` job 也沒有 Python/
`uv` 工具鏈（見該檔案第 62-98 行），因此「讀取 live BFF endpoint 產生
型別」在 CI 中不可行，必須是離線/靜態 schema 匯出策略（見決策 2-3）。

## 介面/API 契約
本票不新增/變更任何對外 HTTP 端點的請求路徑或實際回應內容（位元組層級
不變，見決策 1 的說明）。但本票新增一個**內部**的 schema 匯出/型別產生
契約，具體到開發者不需要自己發明格式：

1. **`bff/scripts/export_openapi.py`**（新檔案）：匯入
   `bff/api/app.py` 的 `app` 物件，呼叫 `app.openapi()`，將結果以
   `json.dumps(schema, indent=2, sort_keys=True) + "\n"` 寫入
   `bff/openapi.json`（新檔案，**提交進版控**，理由見決策 2）。
   ```python
   """Offline OpenAPI schema export (SDLCCT-38): writes bff/openapi.json
   from the FastAPI app's own app.openapi(), so frontend type generation
   (frontend's `npm run generate:types`) never needs a live BFF server or
   a Python toolchain -- CI's frontend job has neither. Run this whenever
   bff/api/app.py's routes or bff/api/schemas.py's response models
   change, then re-run `npm run generate:types` in frontend/, and commit
   both generated files. See docs/design/SDLCCT-38.md.
   """

   import json
   import sys
   from pathlib import Path

   _BFF_ROOT = Path(__file__).resolve().parent.parent
   if str(_BFF_ROOT) not in sys.path:
       sys.path.insert(0, str(_BFF_ROOT))

   from api.app import app  # noqa: E402

   _OUTPUT = _BFF_ROOT / "openapi.json"


   def main() -> None:
       schema = app.openapi()
       _OUTPUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")


   if __name__ == "__main__":
       main()
   ```
   命令：`project-profile.yaml` 新增 `bff_export_openapi: "cd bff && uv run
   python scripts/export_openapi.py"`。

2. **`frontend/lib/generated/bff-types.ts`**（新檔案，**提交進版控**）：
   由 `npx openapi-typescript ../bff/openapi.json -o lib/generated/bff-types.ts`
   產生，匯出 `paths`/`components` 型別（`components["schemas"]["CostOverviewSummary"]`
   等），涵蓋兩個端點目前的回應形狀。命令：`frontend/package.json` 新增
   script `"generate:types": "openapi-typescript ../bff/openapi.json -o lib/generated/bff-types.ts"`，
   `project-profile.yaml` 新增 `frontend_generate_types: "cd frontend &&
   npm run generate:types"`。

3. **開發者的實際操作流程（兩步、都是離線操作，開發者在本機跑，不在
   CI 跑）**：BFF 回應形狀變更時，依序執行
   `bff_export_openapi` → `frontend_generate_types`，然後把
   `bff/openapi.json` 與 `frontend/lib/generated/bff-types.ts` 兩個
   檔案的變更一併提交。CI 兩個 job 都只讀取已提交的檔案，不重新產生
   （見決策 2）。

## 資料模型
不涉及資料表/欄位/索引。但涉及一個**回應形狀宣告**層級的變更，必須在此
明確記錄（屬於本票 HOW 層級的核心技術決策，見決策 1）：`bff/api/app.py`
的兩個路由目前回傳型別標註是 `-> dict`、且未宣告 `response_model`，
FastAPI 在這種情況下對 `app.openapi()` 只能輸出空殼
`{"type": "object"}` schema（沒有任何 `properties`），`openapi-typescript`
從這種 schema 只能產生 `Record<string, never>`/`unknown`，不滿足 AC1
「涵蓋目前的回應形狀」。因此新增 `bff/api/schemas.py`，以 Pydantic
`BaseModel` 宣告兩個端點目前已經在回傳的 dict 形狀（欄位、型別逐一對照
`bff/api/cost_overview.py` 現有的 `get_summary()`/`get_period_comparison()`
回傳內容與 `frontend/lib/cost-overview-api.ts` 現有手寫型別），再透過
`response_model=` 掛到路由上。

```python
# bff/api/schemas.py
"""Pydantic response models for bff/api/app.py's two Cost overview
endpoints (SDLCCT-38): mirror the dict shapes get_summary()/
get_period_comparison() already return (bff/api/cost_overview.py).
Declared here only so FastAPI's app.openapi() emits a concrete response
schema -- without a response_model, FastAPI cannot know the shape of a
`-> dict` return. This is a type declaration only; it does not change
what the endpoints compute or return (see docs/design/SDLCCT-38.md
decision 1)."""

from pydantic import BaseModel


class UnregisteredAgentSpend(BaseModel):
    key: str
    display: str
    spend: float


class Unregistered(BaseModel):
    spend: float
    agents: list[UnregisteredAgentSpend]


class CostOverviewSummary(BaseModel):
    anchor_date: str
    month_start: str
    days_elapsed: int
    days_in_month: int
    total_spend: float
    total_budget: float
    budget_consumed_pct: float | None
    projected_month_end_spend: float | None
    projected_overspend: float | None
    unregistered: Unregistered


class PeriodRange(BaseModel):
    start: str
    end: str


class PeriodComparisonAgent(BaseModel):
    key: str
    display: str
    current_cost: float
    previous_cost: float
    delta: float
    delta_pct: float | None


class PeriodComparison(BaseModel):
    anchor_date: str
    current_period: PeriodRange
    previous_period: PeriodRange
    agents: list[PeriodComparisonAgent]
```

`bff/api/app.py` 的改動（只加 `response_model=`，**不改**路由函式本身的
回傳型別標註、**不改**`cost_overview.py`任何計算邏輯——函式仍然回傳
plain `dict`，FastAPI 用 `response_model` 對這個 dict 做序列化/型別宣告，
實際輸出的 JSON 位元組不變）：

```python
from .schemas import CostOverviewSummary, PeriodComparison


@app.get("/api/cost-overview/summary", response_model=CostOverviewSummary)
def cost_overview_summary() -> dict:
    return get_summary()


@app.get("/api/cost-overview/period-comparison", response_model=PeriodComparison)
def cost_overview_period_comparison() -> dict:
    return get_period_comparison()
```

`bff/pyproject.toml` 的 `dependencies` 新增 `"pydantic>=2"`——目前只是
`fastapi` 的間接依賴，本票第一次直接 `import pydantic`，依專案慣例（見
`fastapi`/`uvicorn` 皆明確列出直接依賴）應明確宣告。

錯誤回應（`exception_handler` 回傳的 `{"error": {...}}` 形狀）**不**
納入本次型別產生範圍：這些是透過 `app.exception_handler` 註冊、FastAPI
不會自動把它們反映進 `app.openapi()` 的 `responses`（需要額外在每個路由
加 `responses={502: {...}, 500: {...}}` 才能讓 schema 收錄），而
`frontend/lib/cost-overview-api.ts` 的 `ApiError` 本來就是前端自訂、给
`fetchJson` 內部 catch 用的型別，不是由 BFF 回應 body 反序列化出來的
資料形狀，AC 也只要求「涵蓋兩個端點目前的回應形狀」（指成功回應），故
`ApiError` 維持手寫、不在本票範圍內改動。

## 現狀盤點：跨元素樣式一致性測試
本票不新增/修改任何 CSS、selector 或畫面渲染輸出，只調整型別定義的來源
與 BFF 兩個路由的 `response_model` 宣告，未搜尋到、也不需要搜尋跨元素
computed-style 一致性測試（這類測試只可能被會改變畫面渲染的變更觸發）。

## 關鍵技術決策

1. **BFF 路由新增 `response_model=`（決策內容見上方「資料模型」段）屬於
   型別宣告，不算 AC5 排除的「新增或調整請求/回應邏輯」。**
   路由函式本身的執行邏輯（呼叫 `get_summary()`/`get_period_comparison()`
   並回傳其 dict）完全不變；`response_model` 只是告訴 FastAPI「這個
   dict 应该长什么样」以供 `app.openapi()` 反映進 schema 與
   `openapi-typescript` 產生對應 TS 型別，不改變任何計算或請求/回應的
   處理流程，也不是本票禁止的「執行期 schema 驗證」新增邏輯——
   `response_model` 本來就是 FastAPI 既有、框架內建的序列化機制，SDLCCT-32
   建立這兩個端點時沒有用到它只是因為當時沒有型別產生的需求，不是刻意
   避開；本票補上它是啟用型別產生這個目的的必要前提，不是額外新增的
   執行期驗證層（純文字宣告，不是本票主動加的 `pydantic`/`jsonschema`
   runtime validate 呼叫）。

2. **離線 schema 匯出：`bff/openapi.json` 提交進版控，不是 `.gitignore`、
   不在 CI 重新產生。**
   CI 的 `frontend` job 完全沒有 Python/`uv` 工具鏈，`bff` job 沒有啟動
   HTTP server（見 `.github/workflows/ci.yml`），兩者都不可能在 CI 內
   跑 `app.openapi()`。提交這個 JSON 檔案讓 `frontend` job 的
   `npm ci`/`npm run build` 完全不需要碰 BFF/Python，與 SDLCCT-40 決策
   （CI 的 `frontend`/`bff` 兩個 job 彼此不互相依賴、各自用自己的工具鏈）
   一致。遵循 SDLCCT-39（i18n 訊息目錄）、SDLCCT-40（demo e2e 測試）等
   先例「產生出來的檔案視為一般原始碼一樣提交，不當成 build artifact
   丟棄」的慣例。

3. **生出來的 TS 型別檔案：`frontend/lib/generated/bff-types.ts`，同樣
   提交進版控，不是 `.gitignore`。**
   理由與決策 2 相同（`frontend` CI job 的 `npm ci`/`npm run build`/
   `npm run lint` 都不應該依賴一個「先跑 codegen」的額外步驟才能通過）；
   且 `frontend/lib/cost-overview-api.ts` 在 build 時期需要 import 這個
   檔案的型別，若未提交、`.next` build 會直接因找不到模組而失敗。放在
   獨立的 `lib/generated/` 子目錄（而非直接放 `lib/` 根目錄）讓「這個
   目錄底下全部是產生出來的檔案」一目了然，方便決策 5 的 lint 排除規則
   用資料夾層級排除，不需要逐檔案列舉。

4. **codegen 工具：`openapi-typescript`（v7.x），加進
   `frontend/package.json` 的 `devDependencies`，不是 `dependencies`。**
   採用票面建議的工具；它是純 build-time 的型別產生 CLI，產生出來的
   `.ts` 檔案本身不含任何執行期程式碼（純 `interface`/`type` 宣告），
   `next build`/`next dev` 執行時不需要這個套件本身，只需要產生出來的
   檔案，故歸類為 `devDependencies`，與 `@playwright/test`、`vitest` 等
   既有開發期工具一致。

5. **產生出來的檔案不手寫自訂「自動產生」標頭註解，直接依賴
   `openapi-typescript` 工具本身預設輸出的標頭註解滿足 AC3。**
   `openapi-typescript` 預設在輸出檔案開頭加入
   `/** This file was auto-generated by openapi-typescript. Do not make
   direct changes to the file. */` 這段標頭，已經滿足 AC3「自動產生、
   請勿手動編輯」標記的要求，不需要再疊加一層自訂標頭增加維護負擔。

6. **Lint 排除：`frontend/eslint.config.mjs` 的 `globalIgnores` 新增
   `"lib/generated/**"`，不嘗試讓產生出來的檔案通過現有手寫程式碼規則。**
   `eslint.config.mjs` 目前已用 `globalIgnores([...])` 覆寫
   `eslint-config-next` 的預設忽略清單（`.next/**`、`out/**`、
   `build/**`、`next-env.d.ts`），本票沿用同一個機制、同一個陣列，新增
   一行 `"lib/generated/**"`，不需要新的 override 區塊。選擇排除而非
   「證實符合現有規則」，是因為 `openapi-typescript` 的輸出格式（例如
   單行超長的 union type、特定的縮排風格）不是為了符合本專案 ESLint 規則
   設計的，每次重新產生都要再跑一次 `eslint --fix` 才能通過並不值得，
   而 AC3 本身就允許「排除」或「證實符合」兩種做法中任選一種。

7. **`cost-overview-api.ts` 的型別改為從產生出來的檔案 re-export，函式
   實作（`fetchJson`/`fetchCostOverviewSummary`/`fetchPeriodComparison`）
   逐字不動。**
   ```ts
   // frontend/lib/cost-overview-api.ts — before (節錄，L11-47)
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
   ```
   ```ts
   // frontend/lib/cost-overview-api.ts — after
   import type { components } from "@/lib/generated/bff-types";

   export type UnregisteredAgentSpend = components["schemas"]["UnregisteredAgentSpend"];
   export type CostOverviewSummary = components["schemas"]["CostOverviewSummary"];
   export type PeriodComparisonAgent = components["schemas"]["PeriodComparisonAgent"];
   export type PeriodComparison = components["schemas"]["PeriodComparison"];
   ```
   其餘內容（`ApiError`、`fetchJson`、`BFF_BASE_URL`、
   `fetchCostOverviewSummary`、`fetchPeriodComparison`，L1-10、L49-89）
   完全不動。保留原本的 export 名稱（`CostOverviewSummary` 等）而不是
   讓呼叫端直接 import `components["schemas"][...]`，是因為
   `period-comparison-section.tsx`、`summary-section.tsx`、
   `cost-dashboard/page.tsx` 三個既有檔案已經 `import type { ... } from
   "@/lib/cost-overview-api"` 這四個名稱（已用 Grep 確認），re-export
   讓這三個檔案完全不用改動，符合 AC2「行為不變」且把改動面縮到最小。

8. **命令命名：`bff_export_openapi`、`frontend_generate_types`，遵循
   `project-profile.yaml` 既有 `bff_*`/`frontend_*` 前綴慣例。**
   `bff_export_openapi` 對照既有 `bff_setup`/`bff_test`/`bff_lint`/
   `bff_coverage`/`bff_run` 命名風格；`frontend_generate_types` 對照既有
   `frontend_setup`/`frontend_build`/`frontend_lint`/`frontend_test`/
   `frontend_e2e`。不把兩個指令合併成一個頂層 `generate_types`，是因為
   它們分屬兩個不同工具鏈（`uv`/Python vs `npm`/Node），與既有
   `bff_*`/`frontend_*` 兩套命令從不互相呼叫對方工具鏈的現有慣例一致。

9. **不在 CI 新增「檢查產生出來的檔案是否與原始碼同步」的 drift-check
   步驟。**
   這類檢查（例如 CI 重新跑一次 export+codegen 再 `git diff --exit-code`）
   能防止開發者忘記重新產生型別就提交，是合理的工程實務，但
   AC 只要求「指令存在且可重複執行、冪等」與「命令整理進既有慣例」，沒有
   要求 CI 強制比對；新增這個步驟需要 CI 的 `frontend` job 擁有 Python/
   `uv` 工具鏈（目前沒有，且背景說明的前提正是避免這件事），等於在本票
   範圍外新增一個新的 CI 能力。依流程第 5 點「本故事的規格要求什麼就設計
   什麼，不要為看得到的未來故事預先設計」，本票不做這個新增，留給未來
   如果真的發生「忘記重新產生」的問題時，再開一張新故事評估。

## UI 原型
不適用，本 Story 不涉及任何前端畫面、樣式或互動變更——純粹是型別定義的
來源替換與 BFF schema 宣告，`fetchCostOverviewSummary()`/
`fetchPeriodComparison()` 呼叫端元件（`summary-section.tsx` 等）零改動，
沒有新的或變更的畫面渲染結果需要人類在 G1b 審核。

## 開放設計問題（定稿時必須為空）
無——規格與既有程式碼已足以決定本票所有 HOW 層級的選擇：離線 schema
匯出機制與檔案位置、committed vs gitignored、codegen 工具與指令、產生
檔案的位置與 lint 排除方式、`project-profile.yaml`/`package.json` 命令
命名、`cost-overview-api.ts` 的 re-export 做法，以及為了讓 AC1「涵蓋
目前的回應形狀」成立所必須新增的 `response_model` 宣告（已論證不構成
AC5 排除的「新增/調整請求回應邏輯」）。
