import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Codec tests run in Node — they don't need a DOM.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Show all test results in CI-like compact form.
    reporters: ["default"],
  },
});
