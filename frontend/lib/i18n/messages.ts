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
      notableNewSpendBadge: "新增顯著支出",
    },
  },
  agents: {
    header: {
      title: "Agent 清單",
      subtitle: "全部 9 個 Agent 的本期預算消耗、近期花費趨勢、治理缺口一覽",
    },
    table: {
      columns: {
        agent: "Agent",
        dept: "部門",
        owner: "負責人",
        budget: "預算",
        currentPeriodSpend: "本期花費",
        budgetConsumedPct: "預算消耗%",
        trend: "趨勢（近 7 天）",
        governance: "治理狀態",
      },
    },
    governanceBadge: {
      hasGap: "治理缺口",
      ok: "正常",
    },
    unknownOwner: "未指定",
    unknownBudget: "未設定",
    footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端成本查詢。" },
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
  anomalies: {
    header: {
      title: "異常與告警",
      subtitle: "彙整各規則偵測到的異常與治理缺口，包含持續中的治理缺口。",
    },
    table: {
      columns: {
        agent: "Agent",
        anomalyType: "異常類型",
        date: "日期",
        reason: "原因",
      },
      ongoing: "持續中",
      unknownAgent: "不明",
    },
    errorBanner: {
      title: "資料錯誤",
      unknownAgent: "不明",
    },
    anomalyTypes: {
      toolRetryLoop: "工具重試迴圈",
      contextBloat: "情境膨脹",
      nightBatchBurst: "非營業時段流量暴增",
      modelSwitch: "模型切換",
      governanceGap: "治理缺口",
    },
    footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端成本查詢。" },
    empty: "目前沒有異常",
  },
  agentDetail: {
    header: { title: "Agent 明細", backToList: "返回 Agent 清單" },
    versionSeries: {
      title: "版本成本時間序列",
      table: {
        columns: {
          version: "版本",
        },
      },
    },
    modelBreakdown: {
      title: "模型成本分解",
      table: {
        columns: {
          model: "模型",
          cost: "成本",
        },
      },
    },
    topTraces: {
      title: "最貴執行清單",
      table: {
        columns: {
          id: "Trace ID",
          cost: "預估成本",
          metadata: "中繼資料",
        },
      },
      metadata: {
        fields: { plant: "廠別", deployedVersion: "版本", dept: "部門", trigger: "觸發方式" },
        more: "更多",
        collapse: "收合",
      },
    },
    footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端成本查詢。" },
    unknown: "—",
  },
  traceDetail: {
    header: { title: "執行詳情", backToAgent: "返回 Agent 明細" },
    empty: "查無資料",
    expand: "展開查看個別",
    collapse: "收合",
    repeatBadge: (count: number) => `× ${count}`,
    footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端 trace/span 查詢。" },
  },
} as const;
