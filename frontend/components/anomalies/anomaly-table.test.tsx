import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentCell,
  AnomalyTable,
  AnomalyTypeBadge,
  formatAnomalyDate,
  ReasonText,
} from "@/components/anomalies/anomaly-table";
import type { AnomalyRow } from "@/lib/anomalies-api";

// SDLCCT-84: AnomalyTable rows now navigate via useRouter() (ClickableRow),
// same mocking precedent as app/agents/governance-badge.test.tsx and
// components/agent-detail/cost-tables.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

const row: AnomalyRow = {
  agent: "agent-1",
  anomaly_type: "model_switch",
  date: "2026-10-18",
  reason: "r",
  status: "open",
};

describe("formatAnomalyDate (SDLCCT-95)", () => {
  it("formats a date as YYYY/MM/DD", () => {
    expect(formatAnomalyDate("2026-10-18")).toBe("2026/10/18");
  });

  it("keeps the ongoing label for null", () => {
    expect(formatAnomalyDate(null)).toBe("持續中");
  });
});

describe("AnomalyTable dates (SDLCCT-95)", () => {
  it("shows the slash date in both the table and the mobile card list", () => {
    const { container } = render(<AnomalyTable rows={[row]} />);
    expect(container.querySelector("table tbody")?.textContent).toContain("2026/10/18");
    expect(container.querySelector("ul")?.textContent).toContain("2026/10/18");
    expect(container.textContent).not.toContain("2026年");
  });
});

// SDLCCT-84 AC2: 異常類型分色標籤 -- model_switch/governance_gap 套用
// StatusBadge，其餘 3 種異常類型維持純文字，不套用任何 badge class。
describe("AnomalyTypeBadge (SDLCCT-84)", () => {
  it("renders an amber (warning) StatusBadge for model_switch", () => {
    render(<AnomalyTypeBadge anomalyType="model_switch" />);
    const badge = screen.getByText("模型切換");
    expect(badge.className).toContain("border-amber-300");
    expect(badge.className).toContain("bg-amber-50");
  });

  it("renders a red (danger) StatusBadge for governance_gap", () => {
    render(<AnomalyTypeBadge anomalyType="governance_gap" />);
    const badge = screen.getByText("治理缺口");
    expect(badge.className).toContain("border-red-300");
    expect(badge.className).toContain("bg-red-50");
  });

  it.each(["tool_retry_loop", "context_bloat", "night_batch_burst"])(
    "renders %s as plain text, with no badge classes applied",
    (anomalyType) => {
      const { container } = render(<AnomalyTypeBadge anomalyType={anomalyType} />);
      expect(container.querySelector(".border-amber-300")).toBeNull();
      expect(container.querySelector(".border-red-300")).toBeNull();
      expect(container.querySelector("span")).toBeNull();
    },
  );
});

// SDLCCT-84 AC1: Agent 欄中文名稱為主要文字，系統代號等寬字放第二行；
// 找不到對照或 agent 為 null 時的 fallback。
describe("AgentCell (SDLCCT-84)", () => {
  it("shows the Chinese display name as primary text with the system code in monospace on the next line", () => {
    const { container } = render(<AgentCell agent="sales-copilot" agentDisplay="銷售副手" />);
    expect(container.textContent).toContain("銷售副手");
    expect(container.textContent).toContain("sales-copilot");
    const codeLine = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "sales-copilot",
    );
    expect(codeLine?.className).toContain("font-mono");
  });

  it("falls back to the system code alone when no display-name match is found", () => {
    const { container } = render(<AgentCell agent="unmapped-agent" agentDisplay={undefined} />);
    expect(container.textContent).toBe("unmapped-agent");
  });

  it("shows the unknown-agent label when agent is null", () => {
    const { container } = render(<AgentCell agent={null} agentDisplay={undefined} />);
    expect(container.textContent).toBe("不明");
  });
});

// SDLCCT-84 決策 5: reason_segments 驅動的 <code> 片段渲染 / null fallback。
describe("ReasonText (SDLCCT-84)", () => {
  it("renders code: true segments as <code> and code: false segments as plain text", () => {
    const { container } = render(
      <ReasonText
        reason="full sentence"
        segments={[
          { text: "模型於 10/18 由 ", code: false },
          { text: "gpt-4", code: true },
          { text: " 切換為 ", code: false },
          { text: "gpt-4o-mini", code: true },
          { text: "，成本偏離正常值約 3 倍", code: false },
        ]}
      />,
    );
    const codeEls = container.querySelectorAll("code");
    expect(codeEls).toHaveLength(2);
    expect(codeEls[0].textContent).toBe("gpt-4");
    expect(codeEls[1].textContent).toBe("gpt-4o-mini");
    expect(container.textContent).toBe(
      "模型於 10/18 由 gpt-4 切換為 gpt-4o-mini，成本偏離正常值約 3 倍",
    );
  });

  it("falls back to plain reason text when segments is null", () => {
    const { container } = render(<ReasonText reason="plain reason text" segments={null} />);
    expect(container.querySelectorAll("code")).toHaveLength(0);
    expect(container.textContent).toBe("plain reason text");
  });
});

// SDLCCT-84 決策 7: agent === null 的列不套用 ClickableRow，維持不可點擊。
describe("AnomalyTable clickable rows (SDLCCT-84)", () => {
  it("does not mark a null-agent row as a clickable row", () => {
    const nullAgentRow: AnomalyRow = {
      agent: null,
      anomaly_type: "governance_gap",
      date: null,
      reason: "r",
      status: "ok",
    };
    const { container } = render(<AnomalyTable rows={[nullAgentRow]} />);
    const tr = container.querySelector("table tbody tr");
    expect(tr).not.toHaveAttribute("role", "button");
  });

  it("marks a row with a non-null agent as a clickable row", () => {
    const { container } = render(<AnomalyTable rows={[row]} />);
    const tr = container.querySelector("table tbody tr");
    expect(tr).toHaveAttribute("role", "button");
  });
});
