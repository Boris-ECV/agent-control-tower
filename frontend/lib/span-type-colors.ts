// Span `type` -> Tailwind badge class lookup (SDLCCT-115 Scenario 3/4).
// Deliberately placed under `lib/`, not `components/trace-detail/`, so the
// SDLCCT-118 waterfall chart component can import this same color table
// directly without depending on the trace-detail tree render component
// tree -- single source of truth for span type colors, must not be
// redefined elsewhere.
//
// `general`, other unknown values, and `null` are intentionally absent --
// callers should fall back to the existing gray badge style via `??`. A
// lookup miss here *is* the correct "keep current state" semantics, not an
// exception to handle (see docs/design/SDLCCT-115.md decision #2).
export const SPAN_TYPE_COLORS: Record<string, string> = {
  llm: "border-purple-300 bg-purple-50 text-purple-700",
  tool: "border-cyan-300 bg-cyan-50 text-cyan-700",
};
