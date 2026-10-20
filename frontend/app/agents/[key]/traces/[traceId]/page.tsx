import { Suspense } from "react";

import { TraceDetailContent } from "@/components/trace-detail/trace-detail-content";

// Same dynamic-route Suspense wrapping pattern as
// app/agents/[key]/page.tsx (see that file's comment for the full
// rationale: next.config.ts's `cacheComponents: true` requires content
// consuming a dynamic route param/client hook to be wrapped in
// <Suspense>). This file stays a server component, doing only this
// wrapping -- the actual page logic (useParams/useFetchOnce/three-state
// rendering) lives in
// components/trace-detail/trace-detail-content.tsx.
export default function TraceDetailPage() {
  return (
    <Suspense fallback={null}>
      <TraceDetailContent />
    </Suspense>
  );
}
