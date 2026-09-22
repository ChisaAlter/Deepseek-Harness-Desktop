import fs from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const appDir = path.resolve(__dirname, "packages/app");
const appNodeModules = path.resolve(appDir, "node_modules");
const rootNodeModules = path.resolve(__dirname, "node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

export default defineConfig({
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@chisacode\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "packages/relay/src/e2ee.ts"),
      },
      {
        find: /^@chisacode\/relay$/,
        replacement: path.resolve(__dirname, "packages/relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(appDir, "src") },
      { find: "@server", replacement: path.resolve(__dirname, "packages/server/src") },
      {
        find: "react-native",
        replacement: path.resolve(rootNodeModules, "react-native-web/dist/index.js"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      { find: "react-dom", replacement: resolvePackageEntry("react-dom") },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
    ],
  },
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/build/**", "**/dist/**"],
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    // v8 coverage provider. Thresholds are intentionally NOT enforced here so
    // `vitest run` without `--coverage` stays green; run `vitest run --coverage`
    // to produce a report. Enforcing thresholds is tracked as a follow-up
    // (see docs/refactors/comprehensive-improvement-roadmap.md).
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "**/dist/**",
        "**/node_modules/**",
        "**/.claude/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.e2e.test.ts",
        "**/*.real.e2e.test.ts",
        "**/test-stubs/**",
        "packages/app/src/i18n/index.ts",
      ],
    },
  },
});
