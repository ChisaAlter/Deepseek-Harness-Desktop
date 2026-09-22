import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("desktop packaging", () => {
  it("unpacks server zsh shell integration files for external shells", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain(
      "node_modules/@chisacode/server/dist/server/terminal/shell-integration/**/*",
    );
    expect(config).not.toContain(
      "node_modules/@chisacode/server/dist/src/terminal/shell-integration/**/*",
    );
  });

  it("excludes package debug/source files from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!**/*.map");
    expect(config).toContain("!node_modules/@chisacode/*/src/**");
    expect(config).toContain("!node_modules/@chisacode/**/*.test.*");
    expect(config).toContain("!node_modules/@chisacode/**/*.spec.*");
  });

  it("publishes desktop update manifests to the ChisaAlter GitHub release feed", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("provider: github");
    expect(config).toContain("owner: ChisaAlter");
    expect(config).toContain("repo: ChisaCode");
  });

  it("adds Windows ASAR integrity after rcedit writes executable metadata", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const buildScript = readFileSync(join(packageRoot, "scripts", "build.js"), "utf8");
    const afterSignScript = readFileSync(join(packageRoot, "scripts", "after-sign.js"), "utf8");

    expect(pkg.scripts?.build).toContain("node scripts/build.js");
    expect(pkg.scripts?.build).not.toContain("electron-builder --config");
    expect(buildScript).toContain("class WindowsAsarIntegrityAfterRceditPackager");
    expect(buildScript).toContain("disableAsarIntegrity: true");
    expect(afterSignScript).toContain("restoreWinAsarIntegrityAfterRcedit");
  });

  // electron-builder packs production dependencies declared in package.json into
  // app.asar. Runtime code in runtime-paths.ts and bin/chisacode dynamically resolves
  // these workspace packages by string, so static analysis (TypeScript, Knip) cannot
  // see the link. If a runtime-required workspace dep is dropped from
  // dependencies, the build still succeeds but ships a broken bundle. This
  // assertion is the safety net.
  it("declares all workspace packages required at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    for (const required of ["@chisacode/cli", "@chisacode/server"]) {
      expect(deps[required], `${required} must be declared in dependencies`).toBe("*");
    }
  });
});
