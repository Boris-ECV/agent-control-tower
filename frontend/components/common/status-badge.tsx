import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// 共用「狀態標籤」元件（SDLCCT-100）。底色＋外框＋色點三個視覺元素，對應
// 規格範例「正常」/「異常」二元狀態，只開 success/danger 兩個 variant（範圍
// 外「不新增狀態種類」）。色值延續既有 GovernanceBadge 已使用的 Tailwind
// 調色盤 class，未經過 docs/design-system.md 的 --color-* token 層——理由
// 見 docs/design/SDLCCT-100.md 關鍵技術決策 1。兩個 variant 的文字/底色對比
// 皆已驗證 >= 4.5:1（異常態 ~5.91:1、正常態 ~7.50:1），見同一設計文件「關
// 鍵技術決策 3」。色點是裝飾性圖形，標記 aria-hidden（文字本身已傳達狀態，
// 螢幕閱讀器不需重複唸出）。children 而非 label: string，比照 ClickableRow
// 既有慣例，呼叫端自行傳入已翻譯文字。
// SDLCCT-84: 新增第三個值 warning（琥珀色），success/danger 既有分支與對比度
// 計算不變——見 docs/design/SDLCCT-84.md 關鍵技術決策 1。
export type StatusVariant = "success" | "danger" | "warning";

export function StatusBadge({
  variant,
  children,
}: {
  variant: StatusVariant;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
        variant === "success"
          ? "border-border bg-gray-50 text-text-secondary"
          : variant === "warning"
            ? "border-amber-300 bg-amber-50 text-amber-700"
            : "border-red-300 bg-red-50 text-red-700",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 flex-none rounded-full",
          variant === "success"
            ? "bg-text-secondary"
            : variant === "warning"
              ? "bg-amber-600"
              : "bg-red-600",
        )}
      />
      {children}
    </span>
  );
}
