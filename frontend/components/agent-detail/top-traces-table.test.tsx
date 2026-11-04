import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopTracesTable } from "@/components/agent-detail/top-traces-table";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ key: "agent-1" }),
}));

afterEach(cleanup);

beforeEach(() => {
  push.mockClear();
  // `Object.assign` 在某些測試順序下會失敗 ---
  // `@testing-library/user-event` 的 `setup()`（本檔新增的廠別篩選測試
  // 有用到）會把 `navigator.clipboard` 重新定義成唯讀的 getter，RTL 的
  // `cleanup()` 不會還原這個 descriptor，導致下一個測試的
  // `Object.assign` 擲出 "has only a getter"。改用
  // `Object.defineProperty` 直接覆蓋整個 descriptor（含 configurable:
  // true），不受前一個測試留下的 getter-only descriptor 影響。
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function tracesWith(id: string) {
  return [
    { id, total_estimated_cost: 12.34, metadata: null },
  ] as unknown as Parameters<typeof TopTracesTable>[0]["traces"];
}

describe("TopTracesTable 執行時間欄", () => {
  it("顯示從合法 UUIDv7 Trace ID 解析出的執行時間（台灣時間，分鐘精度）", () => {
    const ms = Date.UTC(2026, 9, 15, 6, 30, 0); // -> 2026/10/15 14:30 Asia/Taipei
    const hex12 = ms.toString(16).padStart(12, "0");
    const id = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7000-8000-000000000000`;
    render(<TopTracesTable traces={tracesWith(id)} />);
    expect(screen.getByText("2026/10/15 14:30")).toBeInTheDocument();
  });

  it("非合法 UUIDv7 格式的 Trace ID 執行時間欄顯示 em dash，不影響同列其他欄位", () => {
    render(<TopTracesTable traces={tracesWith("trace-001")} />);
    // metadata === null 本身也會以 "—" 顯示（既有行為），所以這裡預期三個
    // em dash：執行時間欄、廠別欄（SDLCCT-111 新增）、中繼資料欄。
    expect(screen.getAllByText("—")).toHaveLength(3);
    // 其他欄位（金額、Trace ID 本身）仍正常渲染。
    expect(screen.getByText("US$ 12.34")).toBeInTheDocument();
    expect(screen.getByText("trace-001")).toBeInTheDocument();
  });
});

describe("TopTracesTable Trace ID 截斷與複製", () => {
  it("36 字元 Trace ID 顯示為前8碼…後4碼截斷格式，完整 ID 放在 title 屬性", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    expect(screen.getByText("0199abcd…5678")).toBeInTheDocument();
    expect(screen.queryByText(id)).not.toBeInTheDocument();
    const wrapper = screen.getByText("0199abcd…5678").closest("span");
    expect(wrapper).toHaveAttribute("title", id);
  });

  it("短字串 Trace ID（既有 e2e fixture 格式）維持完整顯示，不截斷", () => {
    render(<TopTracesTable traces={tracesWith("trace-001")} />);
    expect(screen.getByText("trace-001")).toBeInTheDocument();
  });

  it("點擊複製按鈕會把完整 36 字元 ID 寫入剪貼簿，且不觸發整列導覽", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    const button = screen.getByRole("button", { name: "複製完整 Trace ID" });
    fireEvent.click(button);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(id);
    expect(push).not.toHaveBeenCalled();
  });

  it("按下 Enter/空白鍵在複製按鈕上時不會觸發整列導覽", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    const button = screen.getByRole("button", { name: "複製完整 Trace ID" });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(push).not.toHaveBeenCalled();
  });

  it("點擊列本身（非複製按鈕）仍會觸發既有的導覽行為（SDLCCT-101 相容）", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    // ClickableRow has no aria-label in this usage; select the <tr role="button"> directly.
    const tr = document.querySelector('tr[role="button"]');
    expect(tr).not.toBeNull();
    fireEvent.click(tr as Element);
    expect(push).toHaveBeenCalledWith(
      `/agents/agent-1/traces/${encodeURIComponent(id)}`,
    );
  });

  it("複製成功後短暫顯示「已複製」文字回饋", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    const button = screen.getByRole("button", { name: "複製完整 Trace ID" });
    fireEvent.click(button);
    expect(screen.getByText("已複製")).toBeInTheDocument();
  });
});

describe("TopTracesTable SDLCCT-111 共同中繼資料摘要與廠別欄/篩選", () => {
  function tracesWithMetadata(
    entries: Array<{ id: string; metadata: Record<string, unknown> | null }>,
  ) {
    return entries.map(({ id, metadata }) => ({
      id,
      total_estimated_cost: 1,
      metadata,
    })) as unknown as Parameters<typeof TopTracesTable>[0]["traces"];
  }

  // 摘要 chip 渲染在 <table> 之外的工具列；逐列 chip／廠別欄則渲染在
  // <table> 內。用 closest("table") 是否為 null 來區分兩者，比單純數
  // 文字出現次數更能證明「摺疊到摘要列」與「逐列顯示」的差異（兩者在
  // 只有一筆符合的情況下，文字出現次數可能恰好都是 1）。
  function isInsideTable(el: HTMLElement) {
    return el.closest("table") !== null;
  }

  it("版本/部門/觸發方式皆相同時只在摘要列（表格外）顯示一次，不逐列重複；廠別獨立逐列顯示在表格內", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          {
            id: "trace-001",
            metadata: { plant: "P1", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
          {
            id: "trace-002",
            metadata: { plant: "P2", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
        ])}
      />,
    );

    const versionChip = screen.getByText("版本: v2.1");
    const deptChip = screen.getByText("部門: Sales");
    const triggerChip = screen.getByText("觸發方式: manual");
    expect(isInsideTable(versionChip)).toBe(false);
    expect(isInsideTable(deptChip)).toBe(false);
    expect(isInsideTable(triggerChip)).toBe(false);

    const table = screen.getByRole("table");
    expect(within(table).getByText("P1")).toBeInTheDocument();
    expect(within(table).getByText("P2")).toBeInTheDocument();
    // Folded fields do not also appear a second time per-row.
    expect(within(table).queryByText("版本: v2.1")).not.toBeInTheDocument();
  });

  it("任一列缺少該欄位時視為不一致，維持逐列顯示在表格內（不摺疊到摘要列）", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          {
            id: "trace-001",
            metadata: { plant: "P1", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
          { id: "trace-002", metadata: { plant: "P1", dept: "Sales", trigger: "manual" } },
        ])}
      />,
    );

    // deployed_version 缺一列 -> 不摺疊；row-001 仍逐列顯示自己的 chip,
    // row-002 本來就沒有這個 key 所以不會顯示。
    const versionChip = screen.getByText("版本: v2.1");
    expect(isInsideTable(versionChip)).toBe(true);
    // 部門/觸發方式兩列都有且相同 -> 摘要列摺疊一次（表格外）。
    const deptChip = screen.getByText("部門: Sales");
    const triggerChip = screen.getByText("觸發方式: manual");
    expect(isInsideTable(deptChip)).toBe(false);
    expect(isInsideTable(triggerChip)).toBe(false);
  });

  it("版本不一致時維持逐列顯示，不受部門/觸發方式一致與否影響（逐欄位獨立判斷）", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          {
            id: "trace-001",
            metadata: { plant: "P1", deployed_version: "v2.1", dept: "Sales", trigger: "manual" },
          },
          {
            id: "trace-002",
            metadata: { plant: "P1", deployed_version: "v2.2", dept: "Sales", trigger: "manual" },
          },
        ])}
      />,
    );

    const v1Chip = screen.getByText("版本: v2.1", { exact: false });
    const v2Chip = screen.getByText("版本: v2.2", { exact: false });
    expect(isInsideTable(v1Chip)).toBe(true);
    expect(isInsideTable(v2Chip)).toBe(true);
    const deptChip = screen.getByText("部門: Sales");
    const triggerChip = screen.getByText("觸發方式: manual");
    expect(isInsideTable(deptChip)).toBe(false);
    expect(isInsideTable(triggerChip)).toBe(false);
  });

  it("廠別篩選選項只列出原始清單中出現過的廠別，選擇後只顯示該廠別的列，且選項不隨篩選縮小", async () => {
    const user = userEvent.setup();
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          { id: "trace-001", metadata: { plant: "P1" } },
          { id: "trace-002", metadata: { plant: "P2" } },
        ])}
      />,
    );

    const filter = screen.getByRole("group", { name: "依廠別篩選" });
    expect(within(filter).getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(within(filter).getByRole("button", { name: "P1" })).toBeInTheDocument();
    expect(within(filter).getByRole("button", { name: "P2" })).toBeInTheDocument();
    // No extra plant options beyond what's actually present.
    expect(within(filter).getAllByRole("button")).toHaveLength(3);

    await user.click(within(filter).getByRole("button", { name: "P1" }));
    expect(screen.getByText("trace-001")).toBeInTheDocument();
    expect(screen.queryByText("trace-002")).not.toBeInTheDocument();
    // Options remain available after filtering (not narrowed).
    expect(within(filter).getByRole("button", { name: "P2" })).toBeInTheDocument();
  });

  it("廠別為同一值時仍逐列顯示該欄位，不因篩選後只剩一個值而摺疊", async () => {
    const user = userEvent.setup();
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          { id: "trace-001", metadata: { plant: "P1" } },
          { id: "trace-002", metadata: { plant: "P2" } },
        ])}
      />,
    );
    const filter = screen.getByRole("group", { name: "依廠別篩選" });
    await user.click(within(filter).getByRole("button", { name: "P1" }));
    // 廠別欄依然渲染（不隱藏欄位本身），只剩一列但欄位結構不變。
    const table = screen.getByRole("table");
    expect(within(table).getByText("P1")).toBeInTheDocument();
    expect(within(table).queryByText("P2")).not.toBeInTheDocument();
  });

  it("缺少廠別 key 或 metadata 為 null 時廠別欄顯示既有 em dash", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          { id: "trace-001", metadata: { dept: "Sales" } },
          { id: "trace-002", metadata: null },
        ])}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("所有列皆缺少廠別 key 時，廠別篩選只剩「全部」選項，不因此拋錯或顯示空白選項", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          { id: "trace-001", metadata: { dept: "Sales" } },
          { id: "trace-002", metadata: { dept: "Sales" } },
        ])}
      />,
    );
    const filter = screen.getByRole("group", { name: "依廠別篩選" });
    expect(within(filter).getAllByRole("button")).toHaveLength(1);
    expect(within(filter).getByRole("button", { name: "全部" })).toBeInTheDocument();
  });

  it("廠別選項依字母排序顯示，不依原始資料出現順序", () => {
    render(
      <TopTracesTable
        traces={tracesWithMetadata([
          { id: "trace-001", metadata: { plant: "P9" } },
          { id: "trace-002", metadata: { plant: "P2" } },
        ])}
      />,
    );
    const filter = screen.getByRole("group", { name: "依廠別篩選" });
    const labels = within(filter)
      .getAllByRole("button")
      .map((btn) => btn.textContent);
    expect(labels).toEqual(["全部", "P2", "P9"]);
  });

  it("空清單時不拋錯，且不顯示廠別以外的篩選選項", () => {
    render(<TopTracesTable traces={tracesWithMetadata([])} />);
    const filter = screen.getByRole("group", { name: "依廠別篩選" });
    expect(within(filter).getAllByRole("button")).toHaveLength(1);
    const table = screen.getByRole("table");
    expect(within(table).queryAllByRole("row")).toHaveLength(1); // header row only, no data rows
  });
});
