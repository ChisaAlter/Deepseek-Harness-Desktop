import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildProjectContext,
  discoverModules,
  loadProjectContext,
  workspaceCacheKey,
} from "./project-context.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "project-context-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePkg(dir: string, pkg: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg), "utf8");
}

describe("discoverModules", () => {
  test("discovers npm workspace packages", () => {
    writePkg(tmpDir, { name: "root", workspaces: ["packages/*"] });
    writePkg(path.join(tmpDir, "packages/server"), {
      name: "@app/server",
      description: "Backend",
    });
    writePkg(path.join(tmpDir, "packages/app"), {
      name: "@app/app",
      description: "Frontend",
    });

    const modules = discoverModules(tmpDir);
    expect(modules).toHaveLength(2);
    expect(modules.map((m) => m.name).sort()).toEqual(["@app/app", "@app/server"]);
    expect(modules.find((m) => m.name === "@app/server")?.description).toBe("Backend");
  });

  test("discovers pnpm-style workspaces object", () => {
    writePkg(tmpDir, {
      name: "root",
      workspaces: { packages: ["apps/*", "libs/*"] },
    });
    writePkg(path.join(tmpDir, "apps/web"), { name: "web" });
    writePkg(path.join(tmpDir, "libs/utils"), { name: "utils" });

    const modules = discoverModules(tmpDir);
    expect(modules).toHaveLength(2);
  });

  test("falls back to directory listing without workspaces", () => {
    writePkg(tmpDir, { name: "simple-project" });
    writePkg(path.join(tmpDir, "src-pkg"), { name: "my-lib" });
    mkdirSync(path.join(tmpDir, "bare-src/src"), { recursive: true });
    mkdirSync(path.join(tmpDir, "node_modules/foo"), { recursive: true });
    mkdirSync(path.join(tmpDir, ".git"), { recursive: true });

    const modules = discoverModules(tmpDir);
    const names = modules.map((m) => m.name);
    expect(names).toContain("my-lib");
    expect(names).toContain("bare-src");
    expect(names).not.toContain("foo");
    expect(names).not.toContain(".git");
  });

  test("returns empty for missing package.json", () => {
    expect(discoverModules(path.join(tmpDir, "nonexistent"))).toEqual([]);
  });
});

describe("buildProjectContext", () => {
  test("produces TOC with project name and modules", () => {
    writePkg(tmpDir, { name: "my-monorepo", workspaces: ["packages/*"] });
    writePkg(path.join(tmpDir, "packages/core"), {
      name: "@my/core",
      description: "Core logic",
    });

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.projectName).toBe("my-monorepo");
    expect(ctx.modules).toHaveLength(1);
    expect(ctx.toc).toContain("# Project: my-monorepo");
    expect(ctx.toc).toContain("**@my/core**");
    expect(ctx.toc).toContain("Core logic");
    expect(ctx.builtAt).toBeTypeOf("number");
  });
});

describe("workspaceCacheKey", () => {
  test("produces stable 16-char hex key", () => {
    const key = workspaceCacheKey("/some/path");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(workspaceCacheKey("/some/path")).toBe(key);
  });

  test("different paths produce different keys", () => {
    expect(workspaceCacheKey("/a")).not.toBe(workspaceCacheKey("/b"));
  });
});

describe("loadProjectContext", () => {
  test("caches and reloads context", () => {
    writePkg(tmpDir, { name: "cached", workspaces: ["packages/*"] });
    writePkg(path.join(tmpDir, "packages/a"), { name: "pkg-a" });

    const cacheDir = path.join(tmpDir, ".cache");
    const first = loadProjectContext(tmpDir, cacheDir);
    expect(first.modules).toHaveLength(1);

    // Second load should hit cache
    const second = loadProjectContext(tmpDir, cacheDir);
    expect(second.projectName).toBe("cached");
    expect(second.modules).toHaveLength(1);
  });
});
