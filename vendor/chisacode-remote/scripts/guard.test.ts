/**
 * Architecture guard tests — structural invariants that must never break.
 *
 * Run with: npm run test:guard
 * These replace the standalone .dependency-cruiser.js with in-process checks
 * that run as part of the test suite.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

/** Recursively collect .ts/.tsx files under a directory, skipping node_modules/dist. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Read a file and return its import specifiers (from + dynamic import + require). */
function extractImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  const imports: string[] = [];
  for (const m of content.matchAll(/from\s+["']([^"']+)["']/g)) imports.push(m[1]);
  // Dynamic import with a string literal. Tolerates a leading comment block
  // (e.g. import(/* webpackChunkName: "x" */ "./x")) by scanning for the last
  // quoted string on the line.
  for (const m of content.matchAll(/import\s*\(.*?["']([^"']+)["'].*?\)/g)) imports.push(m[1]);
  for (const m of content.matchAll(/require\s*\(.*?["']([^"']+)["'].*?\)/g)) imports.push(m[1]);
  // Bare side-effect import: `import "x";` (no `from`). Without this a layering
  // violation via a side-effect import slips past the guard.
  for (const m of content.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) imports.push(m[1]);
  return imports;
}

/** Boundary-aware check: does `imp` target workspace package `pkg`? */
function importsPackage(imp: string, pkg: string): boolean {
  const prefix = `@chisacode/${pkg}`;
  return imp === prefix || imp.startsWith(`${prefix}/`);
}

function importsAnyPackage(imp: string, pkgs: string[]): boolean {
  return pkgs.some((pkg) => importsPackage(imp, pkg));
}

function relToRoot(filePath: string): string {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function findViolations(srcDir: string, forbiddenPkgs: string[]): string[] {
  const files = collectSourceFiles(srcDir);
  const violations: string[] = [];
  for (const f of files) {
    for (const imp of extractImports(f)) {
      if (importsAnyPackage(imp, forbiddenPkgs)) {
        violations.push(`${relToRoot(f)}: imports ${imp}`);
      }
    }
  }
  return violations;
}

describe("architecture guards", () => {
  test("protocol must not import other workspace packages", () => {
    const files = collectSourceFiles(path.join(ROOT, "packages/protocol/src"));
    const violations: string[] = [];
    for (const f of files) {
      for (const imp of extractImports(f)) {
        if (imp.startsWith("@chisacode/") && !importsPackage(imp, "protocol")) {
          violations.push(`${relToRoot(f)}: imports ${imp}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("client must not import server", () => {
    expect(findViolations(path.join(ROOT, "packages/client/src"), ["server"])).toEqual([]);
  });

  test("relay must not import server, app, desktop, or cli", () => {
    expect(
      findViolations(path.join(ROOT, "packages/relay/src"), ["server", "app", "desktop", "cli"]),
    ).toEqual([]);
  });

  test("server must not import app, desktop, or cli (client allowed)", () => {
    expect(
      findViolations(path.join(ROOT, "packages/server/src"), ["app", "desktop", "cli"]),
    ).toEqual([]);
  });

  test("session handlers must not import each other directly", () => {
    // Known violations that predate this guard — do not add new entries.
    // The size is locked so the set can only shrink; adding an entry here fails
    // the test, forcing a deliberate review instead of silent grandfathering.
    const KNOWN_VIOLATIONS = new Set([
      "packages/server/src/server/session-handlers/agent-lifecycle-handler.ts: imports sibling handler ./agent-directory-handler.js",
    ]);
    expect(KNOWN_VIOLATIONS.size).toBe(1);
    const handlersDir = path.join(ROOT, "packages/server/src/server/session-handlers");
    let files: string[];
    try {
      files = collectSourceFiles(handlersDir);
    } catch {
      return; // directory may not exist in all branches
    }
    const violations: string[] = [];
    for (const f of files) {
      const rel = relToRoot(f);
      if (
        rel.includes("index.ts") ||
        rel.includes("session-context") ||
        rel.includes("__tests__") ||
        f.endsWith(".test.ts")
      ) {
        continue;
      }
      for (const imp of extractImports(f)) {
        if (
          imp.startsWith("./") &&
          !imp.includes("index") &&
          !imp.includes("session-context") &&
          !imp.includes("types")
        ) {
          const targetBase = path.basename(imp);
          if (targetBase.includes("handler")) {
            violations.push(`${rel}: imports sibling handler ${imp}`);
          }
        }
      }
    }
    const newViolations = violations.filter((v) => !KNOWN_VIOLATIONS.has(v));
    expect(newViolations).toEqual([]);
  });
});
