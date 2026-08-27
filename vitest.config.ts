import { defineConfig } from "vitest/config";

// Minimal config: unit tests only (pure modules under app/lib). No DOM, no
// Remix server runtime.
export default defineConfig({
  test: {
    include: ["app/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
