import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TraceMetaTags } from "@/components/trace-detail/trace-meta-tags";

afterEach(cleanup);

describe("TraceMetaTags", () => {
  it("renders all five tags in order when every value is present", () => {
    render(
      <TraceMetaTags
        agentName="Sales Copilot"
        plant="Plant A"
        deployedVersion="1.2.3"
        dept="Sales"
        trigger="cron"
      />,
    );
    const labels = screen.getAllByText(/./, { selector: "span" }).map((el) => el.textContent);
    expect(labels).toEqual([
      "Sales Copilot",
      "廠別：Plant A",
      "版本：1.2.3",
      "部門：Sales",
      "觸發方式：cron",
    ]);
  });

  it("omits a tag entirely when its value is null, without a placeholder", () => {
    render(
      <TraceMetaTags
        agentName="Sales Copilot"
        plant="Plant A"
        deployedVersion="1.2.3"
        dept={null}
        trigger="cron"
      />,
    );
    expect(screen.queryByText(/部門/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/./, { selector: "span" })).toHaveLength(4);
  });

  it("always renders the agent tag, even though it has no null-check branch", () => {
    render(
      <TraceMetaTags agentName="sales-copilot" plant={null} deployedVersion={null} dept={null} trigger={null} />,
    );
    expect(screen.getByText("sales-copilot")).toBeInTheDocument();
  });
});
