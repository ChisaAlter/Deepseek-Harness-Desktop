import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";

import { convertItem, detectMigrations, rewriteTerms, runMigrations } from "./config-migration.js";

const logger = pino({ level: "silent" });

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "config-migration-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectMigrations", () => {
  test("detects CLAUDE.md → AGENTS.md when switching to codex", () => {
    writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Instructions");
    const { items } = detectMigrations(tmpDir, "codex");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("CLAUDE.md → AGENTS.md");
  });

  test("detects AGENTS.md → CLAUDE.md when switching to claude", () => {
    writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Instructions");
    const { items } = detectMigrations(tmpDir, "claude-code");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("AGENTS.md → CLAUDE.md");
  });

  test("no migration when both files exist", () => {
    writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# A");
    writeFileSync(path.join(tmpDir, "AGENTS.md"), "# B");
    expect(detectMigrations(tmpDir, "codex").items).toHaveLength(0);
    expect(detectMigrations(tmpDir, "claude-code").items).toHaveLength(0);
  });

  test("no migration when source is missing", () => {
    expect(detectMigrations(tmpDir, "codex").items).toHaveLength(0);
  });
});

describe("rewriteTerms", () => {
  test("rewrites claude code → codex", () => {
    expect(rewriteTerms("Use Claude Code for this", "to-codex")).toBe("Use Codex for this");
    expect(rewriteTerms("claude-code config", "to-codex")).toBe("codex config");
  });

  test("rewrites codex → claude code", () => {
    expect(rewriteTerms("Use Codex for this", "to-claude")).toBe("Use Claude code for this");
  });

  test("preserves case of first character", () => {
    expect(rewriteTerms("Claude is great", "to-codex")).toBe("Codex is great");
    expect(rewriteTerms("claude is great", "to-codex")).toBe("codex is great");
  });

  test("respects word boundaries", () => {
    expect(rewriteTerms("claudette is not claude", "to-codex")).toBe("claudette is not codex");
  });

  test("handles multiple occurrences", () => {
    const input = "Claude said claude-code is Claude Code";
    const result = rewriteTerms(input, "to-codex");
    expect(result).not.toContain("Claude");
    expect(result).not.toContain("claude");
  });
});

describe("convertItem", () => {
  test("converts and rewrites terms", () => {
    writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude Code Rules");
    const { items } = detectMigrations(tmpDir, "codex");
    const outcome = convertItem(items[0], logger);
    expect(outcome.status).toBe("success");

    const content = readFileSync(path.join(tmpDir, "AGENTS.md"), "utf8");
    expect(content).toContain("Codex");
    expect(content).not.toContain("Claude");
  });

  test("skips when target exists", () => {
    writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Source");
    writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Existing");
    // detectMigrations won't find items since target exists,
    // so test convertItem directly
    const outcome = convertItem(
      {
        kind: "agents-md",
        direction: "to-codex",
        label: "test",
        source: path.join(tmpDir, "CLAUDE.md"),
        target: path.join(tmpDir, "AGENTS.md"),
      },
      logger,
    );
    expect(outcome.status).toBe("skipped");
  });
});

describe("runMigrations", () => {
  test("runs all detected migrations", () => {
    writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Use Claude Code");
    const { results } = runMigrations(tmpDir, "codex", logger);
    expect(results).toHaveLength(1);
    expect(results[0].outcome.status).toBe("success");
  });

  test("returns empty when no migrations needed", () => {
    const { results } = runMigrations(tmpDir, "codex", logger);
    expect(results).toHaveLength(0);
  });
});
