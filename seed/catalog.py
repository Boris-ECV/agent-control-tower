"""Scenario catalog for the manufacturing "cost runaway" demo.

Token sizes below are the unscaled design values; `SCALE` multiplies them so monthly spend reaches a realistic
level without writing more data (agreed with the customer-facing design).
"""

import random
from collections.abc import Callable
from dataclasses import dataclass

SEED = "mfg-demo-v1"
SCALE = 3
HISTORY_DAYS = 30

# model -> provider (Opik canonical provider names used by its price lookup)
MODELS = {
    "claude-sonnet-4-5": "anthropic",
    "claude-haiku-4-5": "anthropic",
    "gemini-2.5-pro": "google_vertexai",
    "gemini-2.5-flash": "google_vertexai",
    "gpt-4.1": "openai",
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
}

PLANTS = ("台中廠", "高雄廠")
BUSINESS_HOURS_UTC = (0, 10)  # 08:00-18:00 Taiwan time, inside one UTC day

IO = Callable[[random.Random, str], tuple[dict, dict]]


def _n(rng: random.Random, lo: int, hi: int) -> int:
    return rng.randint(lo, hi)


def io_maintenance(rng, plant):
    equip = rng.choice(["CNC 加工中心 A12", "沖壓機 P-07", "射出成型機 IM-31", "空壓機 AC-03", "輸送帶 CV-11"])
    sym = rng.choice(["主軸異音", "油壓不足", "溫度偏高", "震動過大", "定位偏差"])
    return ({"question": f"{plant} {equip} 出現{sym}，請提供排除步驟與所需備品"},
            {"answer": f"建議依序檢查：1) 確認近期保養紀錄 2) 量測{sym}相關參數 3) 依手冊 {_n(rng, 4, 9)}.{_n(rng, 1, 6)} 節更換零件。"})


def io_quality(rng, plant):
    defect = rng.choice(["尺寸超差", "表面刮傷", "毛邊", "色差", "氣孔"])
    lot = f"LOT-{_n(rng, 2026001, 2026999)}"
    return ({"task": f"分析 {plant} {lot} 的「{defect}」可能根因"},
            {"report": f"{lot} {defect}：疑似與模具磨耗及製程溫度波動相關，建議優先檢查 SPC 管制圖。"})


def io_procurement(rng, plant):
    part = rng.choice(["M8 不鏽鋼螺栓", "矽鋼片", "PCB 基板", "伺服馬達", "潤滑油 ISO VG46"])
    return ({"rfq": f"{part} 詢價，數量 {_n(rng, 5, 200) * 100} 件"},
            {"recommendation": f"已比較 {_n(rng, 3, 6)} 家供應商，建議採用交期與單價最佳者。"})


def io_order(rng, plant):
    so = f"SO-{_n(rng, 100000, 999999)}"
    return ({"question": f"訂單 {so} 目前出貨狀態？"},
            {"answer": f"{so} 已完成備貨，預計 {_n(rng, 1, 5)} 個工作天內出貨。"})


def io_supply(rng, plant):
    return ({"scan": f"供應商風險掃描，批次 {_n(rng, 1, 999)}"},
            {"alerts": [f"供應商 S-{_n(rng, 10, 99)} 出現交期延遲風險"]})


def io_scheduler(rng, plant):
    return ({"request": f"{plant} 本週排程重排，插單 {_n(rng, 1, 6)} 張"},
            {"plan": "已重排 3 條產線，預估延遲訂單 0 張。"})


def io_ehs(rng, plant):
    topic = rng.choice(["有機溶劑儲存量上限", "局限空間作業許可", "廢液申報頻率", "噪音作業防護"])
    return ({"question": f"{plant}：{topic}的法規要求？"},
            {"answer": f"依職業安全衛生相關規範，{topic}須符合內部程序 EHS-{_n(rng, 10, 99)}。"})


def io_quoting(rng, plant):
    return ({"request": f"依 BOM-{_n(rng, 1000, 9999)} 產生報價，數量 {_n(rng, 1, 50) * 100}"},
            {"quote": f"預估單價 {_n(rng, 80, 900)} 元，交期 {_n(rng, 14, 45)} 天。"})


def io_scraper(rng, plant):
    return ({"task": "爬取供應商網站價格表"}, {"result": f"已擷取 {_n(rng, 20, 400)} 筆價格資料"})


@dataclass(frozen=True)
class Agent:
    key: str            # Opik project name
    display: str        # shown in the portal
    dept: str
    dept_code: str
    owner: str | None
    model: str
    base_traces: int
    weekend: float
    calls: int
    prompt: int         # unscaled tokens per call
    completion: int
    version: str
    budget: float | None
    workflow: str
    tools: tuple[str, ...]
    llm_steps: tuple[str, ...]
    io: IO
    hours: tuple[int, int] = BUSINESS_HOURS_UTC
    trigger: str = "user"
    jitter: bool = True
    registered: bool = True


AGENTS: tuple[Agent, ...] = (
    Agent("maintenance_copilot", "設備維修助理", "設備部", "eq", "王志明", "claude-sonnet-4-5", 120, 0.3, 2, 12000, 600,
          "v1.7", 900, "repair_guidance", ("retrieve_manual", "query_cmms"), ("rerank_context", "draft_repair_steps"),
          io_maintenance),
    Agent("quality_rca", "品質異常分析", "品保部", "qa", "陳雅婷", "gemini-2.5-pro", 60, 0.3, 5, 6000, 800,
          "v3.0", 400, "defect_root_cause", ("query_spc", "fetch_inspection_log", "lookup_ncr"),
          ("analyze_defect", "propose_root_cause"), io_quality),
    Agent("procurement_rfq", "採購詢價比價", "採購部", "pr", "林建宏", "claude-haiku-4-5", 25, 0.3, 8, 3000, 400,
          "v1.4", 90, "rfq_comparison", ("parse_quote_email", "query_supplier_db"), ("extract_terms", "compare_offers"),
          io_procurement),
    Agent("order_status", "訂單查詢客服", "業務部", "sa", "黃淑芬", "gpt-4o-mini", 400, 0.3, 1, 4000, 250,
          "v1.9", 30, "order_inquiry", ("lookup_order",), ("answer_order_question",), io_order),
    Agent("supply_risk_monitor", "供應鏈風險監控", "採購部", "pr", "林建宏", "gemini-2.5-flash", 24, 1.0, 6, 8000, 500,
          "v2.1", 60, "supplier_risk_scan", ("fetch_news_feed", "query_supplier_db"), ("summarize_signal", "score_risk"),
          io_supply, hours=(0, 24), trigger="scheduler", jitter=False),
    Agent("production_scheduler", "生產排程建議", "生管部", "pp", "張偉倫", "gpt-4.1", 20, 0.3, 3, 20000, 2000,
          "v1.2", 290, "schedule_rebalance", ("fetch_orders", "fetch_capacity"), ("draft_plan", "validate_plan"),
          io_scheduler),
    Agent("ehs_qa", "EHS 法規問答", "EHS", "ehs", "李美玲", "gpt-4o-mini", 80, 0.3, 1, 5000, 400,
          "v1.0", 10, "regulation_qa", ("search_regulations",), ("answer_regulation_question",), io_ehs),
    Agent("quoting_assistant", "報價助理", "業務部", "sa", "黃淑芬", "gpt-4o", 40, 0.3, 2, 9000, 900,
          "v2.4", 220, "quote_generation", ("fetch_bom", "fetch_price_history"), ("estimate_cost", "draft_quote"),
          io_quoting),
    Agent("temp_supplier_scraper", "臨時供應商爬蟲", "未登錄", "none", None, "gpt-4o", 30, 1.0, 4, 6000, 500,
          "v0.1", None, "price_scraper", ("fetch_page",), ("extract_prices",), io_scraper, hours=(0, 24),
          trigger="scheduler", registered=False),
)

COST_CENTERS = {"eq": "CC-EQ01", "qa": "CC-QA01", "pr": "CC-PR01", "sa": "CC-SA01", "pp": "CC-PP01",
                "ehs": "CC-EHS1", "none": "CC-UNK"}

# Ground truth for the manifest only; nothing here is written into Opik.
INCIDENTS = (
    {"id": 1, "agent": "quality_rca", "start_days_ago": 6, "type": "retry_loop",
     "detail": "v3.1 ships; ~15% of runs loop 45 calls, 20% of those end in error"},
    {"id": 2, "agent": "maintenance_copilot", "start_days_ago": 14, "type": "context_bloat",
     "detail": "v1.8 imports full manuals; prompt tokens grow from 1x to 3x"},
    {"id": 3, "agent": "order_status", "start_days_ago": 9, "type": "model_switch",
     "detail": "v2.0 switches gpt-4o-mini to claude-sonnet-4-5, same traffic"},
    {"id": 4, "agent": "procurement_rfq", "start_days_ago": 4, "type": "night_batch_burst",
     "detail": "600 extra runs between 17:00 and 19:00 UTC (night in Taiwan)"},
    {"id": 5, "agent": "temp_supplier_scraper", "start_days_ago": 12, "type": "unregistered_agent",
     "detail": "no owner, no budget; traffic grows 30 to 150 runs per day"},
)
