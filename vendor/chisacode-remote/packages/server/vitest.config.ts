import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./src/test-utils/vitest-setup.ts")],
    pool: "forks",
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/server/**/*.ts"],
      exclude: [
        "src/server/**/__tests__/**",
        "src/server/**/*.test.ts",
        "src/server/**/*.e2e.test.ts",
        "src/server/**/*.real.e2e.test.ts",
        "src/server/**/*.gen.ts",
      ],
      thresholds: {
        // 当前基线目标 — 随着覆盖提升逐步调整
        branches: 30,
        functions: 35,
        lines: 40,
        statements: 40,
      },
    },
  },
});
