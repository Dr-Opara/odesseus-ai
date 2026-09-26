import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // The suite fans out to ~50 worker processes, so every file pays a cold
    // Vite transform of its dependency graph (mammoth, pdf-lib, stripe,
    // next/server) before its first assertion runs. The vitest default 5s
    // testTimeout measures that cold start as test body time and produced
    // spurious failures in first-test-per-file cases. 20s leaves ample
    // headroom for genuine hangs while keeping the suite fast, since these
    // tests are otherwise in-process and finish in well under a second.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/types/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
