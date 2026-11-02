"use client";

import type { KeyboardEvent, ReactNode } from "react";

// 共用「可點擊表格列」元件（SDLCCT-101）。渲染為 <tr>（不包一層 <div>），
// 因為呼叫端（AgentTable、TopTracesTable）本身就是 <table>/<tbody> 結構，
// <tr> 必須是 <tbody> 的直接子元素。統一用 role="button" 搭配 Enter/空白鍵
// 觸發 onActivate，與點擊行為一致；焦點樣式沿用
// docs/design-system.md §8 既有規則。見 docs/design/SDLCCT-101.md。
export function ClickableRow({
  onActivate,
  "aria-label": ariaLabel,
  children,
}: {
  onActivate: () => void;
  "aria-label"?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className="group cursor-pointer border-b border-border last:border-b-0 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </tr>
  );
}
