import { defineConfig } from "@playwright/test";

// Tester-only scratch config: runs on an alternate port (3102) so it never
// collides with a sibling worktree's e2e dev server on 3100/3101 (see
// CLAUDE.md's "Git worktree isolation does NOT isolate Playwright's local
// e2e servers" rule). Not part of the committed project-profile e2e command
// -- used only for this independent tester verification pass.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /sdlcct-110-tester\.spec\.ts/,
  webServer: {
    command: "next build && next start --port 3102",
    url: "http://localhost:3102",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3102",
  },
  workers: 1,
});
