/**
 * Config Migration — convert project config files between agent providers.
 *
 * When switching the active agent for a session (e.g. Claude Code → Codex),
 * project-level config files use different formats. This module detects
 * which conversions are needed and performs them safely (never overwrites
 * existing files, validates before writing).
 *
 * Currently supports Claude Code ↔ Codex for:
 * - CLAUDE.md ↔ AGENTS.md (project instructions)
 *
 * Design adapted from Cindy's cross-agent-convert/ (Apache-2.0).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Logger } from "pino";

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentProvider = "claude-code" | "codex";

export type MigrationKind = "agents-md";

export type MigrationDirection = "to-claude" | "to-codex";

export interface MigrationItem {
  kind: MigrationKind;
  direction: MigrationDirection;
  label: string;
  source: string;
  target: string;
}

export interface DetectResult {
  items: MigrationItem[];
}

export type MigrationStatus = "success" | "skipped" | "failed";

export interface MigrationOutcome {
  status: MigrationStatus;
  detail?: string;
}

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect which config migrations are needed for a given target agent.
 * Only proposes migrations where the source exists and target is missing.
 */
export function detectMigrations(workDir: string, targetAgent: AgentProvider): DetectResult {
  const items: MigrationItem[] = [];
  const direction: MigrationDirection = targetAgent === "claude-code" ? "to-claude" : "to-codex";

  detectAgentsMd(workDir, direction, items);

  return { items };
}

function isNonEmptyFile(p: string): boolean {
  try {
    return readFileSync(p, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function isMissingOrEmpty(p: string): boolean {
  if (!existsSync(p)) return true;
  try {
    return readFileSync(p, "utf8").trim().length === 0;
  } catch {
    return true;
  }
}

function detectAgentsMd(
  workDir: string,
  direction: MigrationDirection,
  items: MigrationItem[],
): void {
  const claudeMd = path.join(workDir, "CLAUDE.md");
  const agentsMd = path.join(workDir, "AGENTS.md");

  if (direction === "to-claude") {
    if (isNonEmptyFile(agentsMd) && isMissingOrEmpty(claudeMd)) {
      items.push({
        kind: "agents-md",
        direction,
        label: "AGENTS.md → CLAUDE.md",
        source: agentsMd,
        target: claudeMd,
      });
    }
  } else {
    if (isNonEmptyFile(claudeMd) && isMissingOrEmpty(agentsMd)) {
      items.push({
        kind: "agents-md",
        direction,
        label: "CLAUDE.md → AGENTS.md",
        source: claudeMd,
        target: agentsMd,
      });
    }
  }
}

// ── Term rewriting ─────────────────────────────────────────────────────────

const CLAUDE_VARIANTS = ["claude code", "claude-code", "claude_code", "claudecode", "claude"];
const CODEX_VARIANTS = ["codex"];
const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Rewrite agent-specific terms in text content.
 * Case-preserving, word-boundary aware.
 */
export function rewriteTerms(content: string, direction: MigrationDirection): string {
  if (direction === "to-codex") {
    return replaceTerms(content, CLAUDE_VARIANTS, "codex");
  }
  return replaceTerms(content, CODEX_VARIANTS, "claude code");
}

function replaceTerms(input: string, variants: string[], replacement: string): string {
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  let out = "";
  let i = 0;

  while (i < input.length) {
    let matched = false;
    for (const v of ordered) {
      if (i + v.length > input.length) continue;
      if (i > 0 && WORD_CHAR.test(input[i - 1])) continue;

      const slice = input.slice(i, i + v.length);
      if (slice.toLowerCase() !== v.toLowerCase()) continue;

      const after = input[i + v.length];
      if (after && WORD_CHAR.test(after)) continue;

      const firstCharIsUpper = /[A-Z]/.test(slice[0]);
      const replaced = firstCharIsUpper
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement;
      out += replaced;
      i += v.length;
      matched = true;
      break;
    }
    if (!matched) {
      out += input[i];
      i += 1;
    }
  }
  return out;
}

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Execute a single migration item. Never overwrites existing target files.
 */
export function convertItem(item: MigrationItem, logger: Logger): MigrationOutcome {
  // Re-check target before writing (may have changed since detection)
  if (!isMissingOrEmpty(item.target)) {
    return { status: "skipped", detail: "target already exists" };
  }

  let content: string;
  try {
    content = readFileSync(item.source, "utf8");
  } catch (error) {
    return {
      status: "failed",
      detail: `cannot read source: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const rewritten = rewriteTerms(content, item.direction);

  try {
    // wx flag: create only if not exists (atomic check)
    writeFileSync(item.target, rewritten, { encoding: "utf8", flag: "wx" });
    logger.info({ label: item.label }, "config migration completed");
    return { status: "success" };
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      return { status: "skipped", detail: "target already exists" };
    }
    return {
      status: "failed",
      detail: `cannot write target: ${e.message}`,
    };
  }
}

/**
 * Run all detected migrations for a target agent.
 * Items are processed serially; single failure does not block others.
 */
export function runMigrations(
  workDir: string,
  targetAgent: AgentProvider,
  logger: Logger,
): { results: Array<{ item: MigrationItem; outcome: MigrationOutcome }> } {
  const { items } = detectMigrations(workDir, targetAgent);
  const results = items.map((item) => ({
    item,
    outcome: convertItem(item, logger),
  }));

  const successCount = results.filter((r) => r.outcome.status === "success").length;
  const skippedCount = results.filter((r) => r.outcome.status === "skipped").length;
  const failedCount = results.filter((r) => r.outcome.status === "failed").length;

  logger.info(
    { targetAgent, total: items.length, successCount, skippedCount, failedCount },
    "config migration batch completed",
  );

  return { results };
}
