import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
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
    // metadata === null 本身也會以 "—" 顯示（既有行為），所以這裡預期兩個
    // em dash：一個是執行時間欄，一個是中繼資料欄。
    expect(screen.getAllByText("—")).toHaveLength(2);
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
    const button = screen.getByRole("button", { name: "複製完整 Trace ID", exact: true });
    fireEvent.click(button);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(id);
    expect(push).not.toHaveBeenCalled();
  });

  it("按下 Enter/空白鍵在複製按鈕上時不會觸發整列導覽", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);
    const button = screen.getByRole("button", { name: "複製完整 Trace ID", exact: true });
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
    const button = screen.getByRole("button", { name: "複製完整 Trace ID", exact: true });
    fireEvent.click(button);
    expect(screen.getByText("已複製")).toBeInTheDocument();
  });
});
