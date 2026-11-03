// 共用「水平進度條」元件（SDLCCT-107）。抽自 `cost-overview/summary-section.tsx`
// 的 `Card` 進度條片段（SDLCCT-82 定案的視覺慣例），不重新定義 class 或 clamp
// 邏輯：容器 `h-1.5 w-full overflow-hidden rounded-full bg-gray-100`；填充
// `h-1.5 rounded-full` + 一般色 `bg-accent` / 警示色 `bg-red-600`；寬度
// `Math.min(100, Math.max(0, pct))%`。警示門檻沿用 `pct > 100`（見
// docs/design/SDLCCT-107.md 關鍵技術決策 3），由呼叫端傳入 `danger`，本元件
// 不自行判斷門檻，以免兩處邏輯分岔。
export function ProgressBar({ pct, danger }: { pct: number; danger: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-1.5 rounded-full ${danger ? "bg-red-600" : "bg-accent"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}
