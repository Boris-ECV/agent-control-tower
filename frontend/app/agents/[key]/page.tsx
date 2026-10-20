import { Suspense } from "react";

import { AgentDetailContent } from "@/components/agent-detail/agent-detail-content";

// 這個 repo 第一個動態路由段：route param (`key`) 只在 request time 才知
// 道，無法在 build time 靜態 prerender（next.config.ts 的
// `cacheComponents: true` 要求消費動態 route param/client hook 的內容包
// 在 `<Suspense>` 裡才允許 blocking fallback）。本檔案保持為 server
// component（不加 "use client"）只做這層 Suspense 包裝，實際頁面邏輯（
// useParams/useFetchOnce/三個區塊渲染）在
// components/agent-detail/agent-detail-content.tsx 的 client component
// 裡（見該檔案開頭註解）。fallback 只在極短暫的 route-param 解析期間顯
// 示，與 useFetchOnce 的 loading 骨架是兩個不同層次。
export default function AgentDetailPage() {
  return (
    <Suspense fallback={null}>
      <AgentDetailContent />
    </Suspense>
  );
}
