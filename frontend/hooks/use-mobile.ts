import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Re-implemented with useSyncExternalStore (React's recommended pattern for
// syncing with a browser API) instead of shadcn's default effect+setState
// boilerplate, which trips this repo's `react-hooks/set-state-in-effect`
// lint rule (synchronous setState call inside an effect body). Behavior is
// unchanged: same breakpoint, same subscription to matchMedia "change".
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
