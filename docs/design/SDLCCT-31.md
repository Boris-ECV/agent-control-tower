# 設計文件 — SDLCCT-31 Governance-gap(未登錄 Agent)異常偵測規則

## 對應需求規格
對應 G1 已核准的需求規格（Jira SDLCCT-31 描述，已內含大部分設計決策，本文件
為正式化與補齊剩餘實作細節）：交叉比對 `seed/registry.py` 的登錄狀態
（registered/owner/budget）與 Opik 逐日花費紀錄，自動標記「未登錄、無負責人
或無預算卻持續產生花費」的 Agent。旗標條件（已決定，零誤報，已用
`catalog.AGENTS` 9 個 Agent 驗證）：`registered is False or owner is None or
budget is None`，任一成立即標記；9 個 Agent 中僅 `temp_supplier_scraper`
滿足。涵蓋 5 條 Gherkin AC：(1) 標記 `temp_supplier_scraper`、(2) 其餘 8 個
已登錄 Agent 不誤報、(3) 輸出含具體數字（花費數字，非僅布林旗標）、(4)
`project_ids` 為空時拋例外、(5) 無花費資料時仍可標記（不因查無花費而漏報）。
範圍外：畫面呈現、自動處置、AI 生成文字、花費成長門檻（已確認零誤報，不需要）。
依賴：E2（Done）、`seed/registry.py`（Done）、
`bff/opik_workspace.get_workspace_daily_costs`（Done）。

## 介面/API 契約
本 Story 不新增對外 HTTP 端點；對外介面是一個純 Python 函式（供未來報表/CLI/
Portal 呼叫），簽名與回傳形狀已在 Jira 描述中定案，逐字採用：

新增檔案：**`bff/anomaly_governance_gap.py`**（決策理由見下方「關鍵技術決策」；
檔名依 SDLCCT-27 建立的「每條規則一個 `bff/anomaly_<rule_name>.py`」慣例命名，
於 G1b 審查時與 SDLCCT-27 一併確認並由 orchestrator 統一調整，純改名、不改
任何函式/介面行為）。

```python
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from opik_metrics import MetricPoint


@dataclass(frozen=True)
class GovernanceGapFinding:
    key: str
    display: str
    owner: str | None
    budget: float | None
    registered: bool
    daily_costs: tuple[MetricPoint, ...]
    first_day_cost: float | None
    last_day_cost: float | None


def find_governance_gaps(
    project_ids: Sequence[str],
    *,
    interval_start: datetime,
    interval_end: datetime,
) -> tuple[GovernanceGapFinding, ...]:
    """對 project_ids 逐一查 registry.get_agent(key)（seed/registry.py，見下方
    sys.path 決策），篩出 registered is False or owner is None or
    budget is None 者；只對篩出的子集合呼叫一次
    opik_workspace.get_workspace_daily_costs() 取得逐日花費，組成
    GovernanceGapFinding tuple 回傳（依 project_ids 原始順序）。

    - project_ids 為空 -> MissingProjectIdsError（沿用
      get_workspace_daily_costs 的例外型別與訊息風格），在呼叫
      get_agent 之前就先檢查，不等下游自然拋出（因為下游呼叫在本函式內
      是條件式的，見下方決策）。
    - project_ids 中若有 registry.get_agent() 查無紀錄的 key（本專案
      9 個 Agent 皆已在 catalog.AGENTS 中，理論上不會發生），靜默跳過
      不計入回傳 -- 無法對不存在的紀錄套用旗標條件，回傳 None 的語意
      就是「無此 Agent」，不是「這個 Agent 沒有治理缺口」，兩者不應混
      為一談但也不构成本 Story 要處理的案例,是防禦性處理。
    - 若篩出的旗標子集合為空，直接回傳空 tuple，不呼叫
      get_workspace_daily_costs()（避免對空清單呼叫而意外觸發
      MissingProjectIdsError，該例外只應反映「使用者傳入的 project_ids
      本身是空的」這一種情境，見 AC4）。
    """
```

呼叫範例（開發者可直接依此實作，不必自行發明介面）：
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "seed"))
from registry import get_agent  # noqa: E402

from opik_workspace import get_workspace_daily_costs
from opik_metrics import MissingProjectIdsError
```

## 資料模型
無新增資料表/索引（本 Story 不碰任何資料庫）。新增的「資料形狀」僅限於
`GovernanceGapFinding`（上方已列出完整欄位），是一個唯讀 `frozen` dataclass，
純粹是 `seed/registry.py` 的登錄欄位 + `bff/opik_workspace.py` 的逐日花費組合
後的記憶體內投影，不落地、不快取。

**`seed/registry.py` 字典 -> `GovernanceGapFinding` 欄位對照（直接 1:1，無改
名、無轉換）：**

| registry dict 欄位 | GovernanceGapFinding 欄位 | 說明 |
|---|---|---|
| `key` | `key` | 直接複製 |
| `display` | `display` | 直接複製 |
| `owner` | `owner` | 直接複製（`str \| None`） |
| `budget` | `budget` | 直接複製（`float \| None`） |
| `registered` | `registered` | 直接複製（`bool`） |
| `dept` | （不採用） | registry 多出的欄位，本 Story 的 Gherkin AC 不需要部門資訊，不塞進 dataclass |
| `dept_code` | （不採用） | 同上 |
| （無對應來源） | `daily_costs` | 來自 `get_workspace_daily_costs()` 回傳 dict 的 `.get(key, ())` |
| （無對應來源） | `first_day_cost` | 衍生欄位，見下方決策 |
| （無對應來源） | `last_day_cost` | 衍生欄位，見下方決策 |

## 關鍵技術決策

- **新檔案放在 `bff/anomaly_governance_gap.py`，不放在 `seed/` 底下**——這是
  一個橫跨 `seed`（登錄靜態資料）與 `bff`（Opik 即時花費資料）兩個套件的
  彙整查詢,性質上更接近既有 `bff/opik_workspace.py`、`bff/opik_traces.py`
  這類「對 Portal/報表提供彙整資料」的 BFF 層模組,而不是 `seed/` 底下那些
  「產生/驗證種子資料」的腳本。**G1b 審查時已與平行進行的 SDLCCT-27 對齊
  命名慣例**：SDLCCT-27 建立了「每條具體規則一個 `bff/anomaly_<rule_name>.py`」
  的分檔慣例（例如 `bff/anomaly_context_bloat.py`），本設計原先用的泛用
  檔名 `bff/anomaly.py` 已改為 `bff/anomaly_governance_gap.py` 以符合該
  慣例（純改名，下方所有函式簽名/介面/行為決策完全不變）。

- **`bff/anomaly_governance_gap.py` 如何匯入 `seed/registry.py`：執行期用
  `sys.path.insert()` 把 `seed/` 目錄加入 path，再用裸 import
  `from registry import get_agent`**——這不是理想的套件結構，但是本 repo
  目前對 `seed/` 與 `bff/` 刻意維持兩個獨立的 `pyproject.toml`（各自
  `pythonpath = ["."]`），彼此沒有宣告任何套件依賴關係，也沒有根層級
  `pyproject.toml`/`conftest.py` 做跨套件 path 設定（已確認：全repo 搜尋
  `sys.path.insert`/`conftest.py` 均無結果）。新增一個正式的套件依賴（例如
  讓 `bff` 的 `pyproject.toml` 宣告依賴 `seed` 這個 local path package）
  牽動兩個套件的打包方式，超出本 Story 範圍；用 `sys.path` 在呼叫處就地
  插入是風險最低、不影響其他模組的做法，且與 `registry.py` 自己
  `from catalog import AGENTS` 的裸 import 風格一致（該風格本就假設呼叫方
  會把正確的目錄放上 path，不是本 Story 新發明的慣例）。

- **對應地，`bff/pyproject.toml` 的 `[tool.pytest.ini_options]` 需把
  `pythonpath` 從 `["."]` 改成 `[".", "../seed"]`**——讓
  `bff/tests/test_anomaly_governance_gap.py` 能直接 `import registry`（或對它 monkeypatch/
  mock）而不必重複上面的 `sys.path.insert` 技巧；只加這一行，不改
  `testpaths`/`coverage` 設定。

- **`find_governance_gaps()` 只對篩出旗標的子集合呼叫一次
  `get_workspace_daily_costs()`，不是每個 Agent各呼叫一次**——
  `get_workspace_daily_costs(project_ids, ...)` 本身的簽名就是設計成接受
  一個 project_id 清單、一次 POST 打 `/v1/private/workspaces/costs`
  （見 `bff/opik_workspace.py` docstring：「Backend scopes the response to
  the requested project_ids itself」），批量呼叫一次即可拿到所有旗標 Agent
  的逐日花費，比逐一呼叫省下 N-1 次 HTTP round-trip，也不會對後端產生不必
  要的負載；N 很小（本專案最多 9 個 Agent）也不會有單次 payload 過大的風
  險。前提是「子集合不為空才呼叫」（見下一條決策），避免誤用空清單觸發
  `MissingProjectIdsError`。

- **區分「`project_ids`（函式輸入）為空」vs「旗標篩選後子集合為空」兩種
  空清單，只有前者拋例外**——AC4 明確要求「project_ids 空時拋例外」，這是
  呼叫者的輸入契約錯誤，在函式最前面就主動 `raise MissingProjectIdsError`
  （沿用 `bff/opik_metrics.py` 定義、`bff/opik_workspace.py` re-export 的
  同一個例外型別與訊息風格，不是自己重新定義一個新例外類別）。但「9 個
  Agent 全部都已登錄，篩不出任何旗標」是正常、合法的結果（AC2 的情境），
  此時回傳空 tuple，絕不能呼叫 `get_workspace_daily_costs([])` 讓它誤判成
  AC4 的輸入錯誤——兩者語意完全不同，混用會把一個正常的「零治理缺口」結
  果錯誤地變成例外。

- **「`project_id` 在回傳 dict 中完全缺席」與「對應到一個空 tuple」兩種情
  況，一視同仁處理為 `daily_costs = ()`**——`get_workspace_daily_costs()`
  的 docstring 已說明「回傳 dict 的 key 就是後端實際回資料的那些
  project_ids」，意味著查無花費的 project_id 可能完全不出現在 dict 裡，也
  可能出現但對應空 tuple（兩者在目前後端行為下無法從呼叫端嚴格區分，也沒
  有必要區分）。實作用 `costs_map.get(key, ())`，兩種情況統一得到空 tuple，
  滿足 AC5「無花費資料時仍可標記」：無論是哪一種空的樣子，Finding 一樣會
  被建立，只是 `daily_costs=()`、`first_day_cost=None`、
  `last_day_cost=None`。

- **`first_day_cost`/`last_day_cost` 衍生自 `daily_costs` 的首/末個
  `MetricPoint.value`，空 tuple 時兩者皆為 `None`，絕不補 0**——
  `daily_costs` 已依後端回傳順序排列（`get_workspace_daily_costs` 內部用
  `tuple()` 保留 `res["data"]` 原始順序，未重新排序），直接取
  `daily_costs[0].value`/`daily_costs[-1].value`；若該 `MetricPoint.value`
  本身是 `None`（`opik_metrics.MetricPoint` 的既有語意：`None` =「未知」，
  絕不強制轉成 0.0），原樣往外傳遞，不在這一層吞掉或轉換，維持與
  `bff/opik_metrics.py`/`bff/opik_workspace.py` 一致的「未知就是 None，不
  是 0」慣例。此欄位滿足 AC3「輸出含具體數字」——輸出的是實際花費數字（或
  明確的 None），不是單純的布林旗標。

- **`registry.get_agent(key)` 回傳 `None`（查無此 Agent）時靜默跳過，不
  計入回傳結果、也不拋例外**——規格給定的情境是「`catalog.AGENTS` 9 個
  Agent」，`project_ids` 預期就是從這 9 個 key 來，理論上不會出現查無紀錄
  的情況；但函式簽名收的是任意 `Sequence[str]`，為避免對不存在的 key 做出
  「這個 Agent 沒有治理缺口」這種沒有事實根據的判斷（那等同於憑空決定一
  個規格沒講的行為），選擇跳過而不是報告或拋例外，是最保守、不擅自延伸規
  格的處理方式。

## UI 原型
無，本 Story 不涉及前端畫面（純後端彙整函式，產出給未來報表/Portal 使用；
不產生、不修改任何元件、版面或樣式）；本 repo 目前也沒有可比對的前端畫面，
故無跨元素樣式耦合測試需要檢查。

## 開放設計問題(定稿時必須為空)
（無）
