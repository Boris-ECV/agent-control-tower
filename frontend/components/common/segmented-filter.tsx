"use client";

import type { ReactNode } from "react";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

// 共用「分段按鈕篩選器」元件（SDLCCT-102）。以 @base-ui/react 的
// ToggleGroup/Toggle 為基礎（已安裝依賴，非新增套件），單選、可選
// 已選取樣式、鍵盤方向鍵巡覽與 roving tabindex 皆由 primitive 內建提供，
// 不另外手刻 onKeyDown。右側 countLabel 由呼叫端自行組好已翻譯文字傳入
// （例如「顯示 3 / 10」），本元件不內嵌任何語言字串。見
// docs/design/SDLCCT-102.md。
export interface SegmentedFilterOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

export function SegmentedFilter<Value extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  countLabel,
}: {
  options: SegmentedFilterOption<Value>[];
  value: Value;
  onChange: (next: Value) => void;
  "aria-label": string;
  countLabel?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <ToggleGroup
        aria-label={ariaLabel}
        value={[value]}
        onValueChange={(next) => {
          // ToggleGroup 的單選語意仍允許點擊目前已選取的選項清空為
          // 空陣列，對篩選器不合理（不能「沒有任何選項生效」）；只有
          // 當新陣列剛好剩 1 個值時才往外呼叫 onChange，忽略會清空選取
          // 的點擊，確保外部永遠維持「剛好一個選項被選取」的不變量。
          if (next.length === 1) {
            onChange(next[0] as Value);
          }
        }}
        className="flex items-center gap-1 rounded-lg border border-border bg-gray-50 p-1"
      >
        {options.map((option) => (
          <Toggle
            key={option.value}
            value={option.value}
            className="rounded-md px-3 py-1 text-sm font-medium text-text-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-pressed:bg-bg data-pressed:text-text-primary data-pressed:shadow-sm data-pressed:border data-pressed:border-border"
          >
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {countLabel !== undefined && (
        <span className="text-sm text-text-secondary">{countLabel}</span>
      )}
    </div>
  );
}
