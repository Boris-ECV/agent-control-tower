import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["node_modules/**", "e2e/**"],
    env: {
      // app/agents/page.tsx (indirectly, via lib/agents-api.ts ->
      // lib/api-client.ts) throws at module-load time if this is unset.
      // Tests here never actually make a network call, so any value works.
      NEXT_PUBLIC_BFF_URL: "http://localhost:8000",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
