import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";

afterEach(cleanup);

const ITEMS = [
  { label: "治理", href: "/agents" },
  { label: "Agent 清單", href: "/agents" },
  { label: "Sales Copilot", href: "/agents/sales-copilot" },
  { label: "trace-01…", title: "trace-0123456789abcdef" },
];

describe("Breadcrumbs", () => {
  it("renders a labelled nav with one li per level", () => {
    render(<Breadcrumbs items={ITEMS} />);
    expect(screen.getByRole("navigation", { name: "麵包屑" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders non-last levels as links with correct hrefs and no aria-current", () => {
    render(<Breadcrumbs items={ITEMS} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/agents",
      "/agents",
      "/agents/sales-copilot",
    ]);
    links.forEach((l) => expect(l).not.toHaveAttribute("aria-current"));
  });

  it("renders the last level as plain text with aria-current=page and full title", () => {
    render(<Breadcrumbs items={ITEMS} />);
    const last = screen.getByText("trace-01…");
    expect(last.tagName).toBe("SPAN");
    expect(last).toHaveAttribute("aria-current", "page");
    expect(last).toHaveAttribute("title", "trace-0123456789abcdef");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("ignores href on the last level", () => {
    render(<Breadcrumbs items={[{ label: "A", href: "/a" }, { label: "B", href: "/b" }]} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("B")).toHaveAttribute("aria-current", "page");
  });

  it("hides separators from the accessibility tree", () => {
    const { container } = render(<Breadcrumbs items={ITEMS} />);
    const seps = container.querySelectorAll('[aria-hidden="true"]');
    expect(seps).toHaveLength(3);
    seps.forEach((s) => expect(s.textContent).toBe("/"));
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("listitem")).toHaveLength(4);
  });

  it("uses label as title by default and truncates long text", () => {
    render(<Breadcrumbs items={ITEMS} />);
    const link = screen.getByRole("link", { name: "Sales Copilot" });
    expect(link).toHaveAttribute("title", "Sales Copilot");
    expect(link.className).toContain("truncate");
    expect(screen.getByText("trace-01…").className).toContain("truncate");
  });
});
