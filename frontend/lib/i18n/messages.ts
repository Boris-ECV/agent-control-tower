export const messages = {
  sidebar: {
    groups: {
      overview: "總覽",
      governance: "治理",
      operations: "操作",
      settings: "設定",
    },
    items: {
      costDashboard: "成本儀表板",
      agentList: "Agent 清單",
      anomalyAlerts: "異常與告警",
      budgetSimulation: "預算與節省模擬",
      policyEngine: "政策引擎",
      approvalFlow: "核准流程",
      pauseAgent: "暫停 Agent",
      emergencyShutdown: "緊急關閉",
      system: "系統",
    },
  },
  costOverview: {
    header: {
      today: "今天（台灣時間）：",
      unavailable: "無法取得",
      title: "成本總覽",
      subtitle: "本月成本 vs 預算、預估月底超支、跨 Agent 期間比較",
    },
    summarySection: { title: "本月成本 vs 預算總覽" },
    periodSection: {
      title: "跨 Agent 期間比較",
      heading: "跨 Agent 期間比較（誰漲最多）",
    },
    footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端成本查詢。" },
    summary: {
      totalSpend: {
        label: "本月總花費（含未登錄 Agent）",
        sub: "9 個 Agent 累計（COST，本月至今）",
      },
      totalBudget: { label: "本月總預算", sub: "已登錄 Agent 的 budget 加總" },
      budgetConsumedPct: {
        label: "預算消耗百分比",
        subOverBudget: "已超過本月預算",
        subWithinBudget: "尚在預算內",
      },
      projectedOverspend: {
        label: "預估月底超支金額",
        sub: (daysInMonth: number) =>
          `依目前花費速度線性外推至月底（第 ${daysInMonth} 天）`,
      },
      governanceGap: {
        hasGap: (count: number) => `⚠ 治理缺口：${count} 個 Agent 未登錄`,
        noGap: "✓ 無治理缺口：所有 Agent 皆已登錄",
        note: "花費計入總花費，但不計入總預算分母",
      },
      unregisteredBadge: "未登錄",
    },
    period: {
      currentPeriod: (range: string) => `本期花費（${range}）`,
      previousPeriod: (range: string) => `前期花費（${range}）`,
      delta: "漲幅",
    },
  },
  errorCard: {
    loadFailedTitle: (title: string) => `無法載入「${title}」`,
    queryFailed: (endpoint: string, status: string, message?: string) =>
      `查詢失敗：${endpoint} 回應 ${status}${message ? `（${message}）` : ""}。其他卡片資料不受影響。`,
    connectionUnavailable: "無法連線",
    retry: "重試",
  },
  app: {
    metadata: {
      title: "成本總覽 — Agent Control Tower",
      description: "本月成本 vs 預算總覽、預估月底超支、跨 Agent 期間比較。",
    },
  },
} as const;
