import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    // Uniquement les tests backend : ceux du frontend exigent jsdom + le setup
    // de frontend/vitest.config.ts et échouent (« reading 'body' ») si cette
    // config-ci les attrape. Les lancer depuis frontend/.
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
