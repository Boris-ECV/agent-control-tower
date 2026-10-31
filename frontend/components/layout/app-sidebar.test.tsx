import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

afterEach(cleanup);

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
  return {
    agentList: screen.getByRole("link", { name: "Agent 清單" }),
    cost: screen.getByRole("link", { name: "成本儀表板" }),
    anomalies: screen.getByRole("link", { name: "異常與告警" }),
  };
}

describe("AppSidebar active state", () => {
  it.each(["/agents", "/agents/sales-copilot", "/agents/sales-copilot/traces/trc_123"])(
    "highlights Agent 清單 at %s",
    (path) => {
      const { agentList, cost, anomalies } = renderAt(path);
      expect(agentList).toHaveAttribute("data-active");
      expect(cost).not.toHaveAttribute("data-active");
      expect(anomalies).not.toHaveAttribute("data-active");
    },
  );

  it("does not highlight Agent 清單 on the cost dashboard", () => {
    const { agentList, cost } = renderAt("/cost-dashboard");
    expect(agentList).not.toHaveAttribute("data-active");
    expect(cost).toHaveAttribute("data-active");
  });
});
