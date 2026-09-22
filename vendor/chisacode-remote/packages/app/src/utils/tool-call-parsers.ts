import { z } from "zod/v3";
import type { HighlightToken } from "@chisacode/highlight";

/** A run of text within a diff line, flagged as changed or unchanged for word-level highlighting. */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

/** A single line of a diff produced from tool-call inputs, with optional word-level segments and highlight tokens. */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  segments?: DiffSegment[];
  // Syntax-highlight tokens for the code on this line (prefix char excluded),
  // attached by highlightDiffLines when the file's language is supported.
  tokens?: HighlightToken[];
}

function splitIntoLines(text: string): string[] {
  if (!text) {
    return [];
  }

  return text.replace(/\r\n/g, "\n").split("\n");
}

function splitIntoWords(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inWord = false;

  for (const char of text) {
    const isWordChar = /\w/.test(char);
    if (isWordChar) {
      if (!inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = true;
      current += char;
    } else {
      if (inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = false;
      current += char;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function computeWordLevelDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } {
  const oldWords = splitIntoWords(oldLine);
  const newWords = splitIntoWords(newLine);

  const m = oldWords.length;
  const n = newWords.length;

  // Guard against the LCS DP blowing up on huge single-line edits (a 10k-word
  // rewrite would allocate a 100M-cell table ≈ 800MB). Degrade to "whole line
  // changed" segments instead of freezing the main thread.
  if (m * n > MAX_WORD_LCS_CELLS) {
    return {
      oldSegments: [{ text: oldLine, changed: true }],
      newSegments: [{ text: newLine, changed: true }],
    };
  }

  // LCS to find common words
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Mark which words are in LCS (unchanged)
  const oldInLCS = new Set<number>();
  const newInLCS = new Set<number>();

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      oldInLCS.add(i);
      newInLCS.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  // Build segments: consecutive unchanged or changed words merged
  const buildSegments = (words: string[], inLCS: Set<number>): DiffSegment[] => {
    if (words.length === 0) return [];

    const segments: DiffSegment[] = [];
    let currentText = "";
    let currentChanged: boolean | null = null;

    for (let idx = 0; idx < words.length; idx++) {
      const word = words[idx];
      const changed = !inLCS.has(idx);

      if (currentChanged === null) {
        currentText = word;
        currentChanged = changed;
      } else if (changed === currentChanged) {
        currentText += word;
      } else {
        segments.push({ text: currentText, changed: currentChanged });
        currentText = word;
        currentChanged = changed;
      }
    }

    if (currentText) {
      segments.push({ text: currentText, changed: currentChanged ?? false });
    }

    return segments;
  };

  const oldSegments = buildSegments(oldWords, oldInLCS);
  const newSegments = buildSegments(newWords, newInLCS);

  return {
    oldSegments,
    newSegments,
  };
}

/**
 * Builds a line-level diff between two versions of a text, with word-level segments for changed pairs.
 * @param originalText The text before the change
 * @param updatedText The text after the change
 * @returns The diff lines, prefixed with -, +, or space
 */

/** Upper bound on LCS DP cells for line-level diffs (~16MB table). */
const MAX_LINE_LCS_CELLS = 2_000_000;

/** Upper bound on LCS DP cells for word-level diffs (~2MB table). */
const MAX_WORD_LCS_CELLS = 250_000;

/**
 * Degraded diff for oversized inputs: keep the unchanged common prefix and
 * suffix as context lines and mark everything in between removed/added.
 */
function buildDegradedLineDiff(originalLines: string[], updatedLines: string[]): DiffLine[] {
  const diff: DiffLine[] = [];
  let prefix = 0;
  const maxPrefix = Math.min(originalLines.length, updatedLines.length);
  while (prefix < maxPrefix && originalLines[prefix] === updatedLines[prefix]) {
    diff.push({ type: "context", content: ` ${originalLines[prefix]}` });
    prefix += 1;
  }
  const originalTail = originalLines.length - prefix;
  const updatedTail = updatedLines.length - prefix;
  let suffix = 0;
  const maxSuffix = Math.min(originalTail, updatedTail);
  while (
    suffix < maxSuffix &&
    originalLines[originalLines.length - 1 - suffix] ===
      updatedLines[updatedLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const originalMiddleEnd = originalLines.length - suffix;
  for (let i = prefix; i < originalMiddleEnd; i += 1) {
    diff.push({ type: "remove", content: `-${originalLines[i]}` });
  }
  const updatedMiddleEnd = updatedLines.length - suffix;
  for (let j = prefix; j < updatedMiddleEnd; j += 1) {
    diff.push({ type: "add", content: `+${updatedLines[j]}` });
  }
  for (let k = originalMiddleEnd; k < originalLines.length; k += 1) {
    diff.push({ type: "context", content: ` ${originalLines[k]}` });
  }
  return diff;
}
export function buildLineDiff(originalText: string, updatedText: string): DiffLine[] {
  const originalLines = splitIntoLines(originalText);
  const updatedLines = splitIntoLines(updatedText);

  const hasAnyContent = originalLines.length > 0 || updatedLines.length > 0;
  if (!hasAnyContent) {
    return [];
  }

  const m = originalLines.length;
  const n = updatedLines.length;

  // Guard: the LCS DP table is O(m×n) cells (~8 bytes/cell). A 10k×10k line
  // edit (large generated files) would allocate ~800MB and freeze the app.
  // Fall back to a linear common-prefix/suffix diff instead.
  if (m * n > MAX_LINE_LCS_CELLS) {
    return buildDegradedLineDiff(originalLines, updatedLines);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (originalLines[i] === updatedLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (originalLines[i] === updatedLines[j]) {
      diff.push({ type: "context", content: ` ${originalLines[i]}` });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", content: `-${originalLines[i]}` });
      i += 1;
    } else {
      diff.push({ type: "add", content: `+${updatedLines[j]}` });
      j += 1;
    }
  }

  while (i < m) {
    diff.push({ type: "remove", content: `-${originalLines[i]}` });
    i += 1;
  }

  while (j < n) {
    diff.push({ type: "add", content: `+${updatedLines[j]}` });
    j += 1;
  }

  // Post-process to add word-level segments for adjacent remove/add pairs
  for (let idx = 0; idx < diff.length - 1; idx++) {
    const curr = diff[idx];
    const next = diff[idx + 1];

    if (curr.type === "remove" && next.type === "add") {
      // Strip the leading -/+ from content for comparison
      const oldLineText = curr.content.slice(1);
      const newLineText = next.content.slice(1);

      const { oldSegments, newSegments } = computeWordLevelDiff(oldLineText, newLineText);
      curr.segments = oldSegments;
      next.segments = newSegments;
    }
  }

  return diff;
}

/**
 * Parses unified diff text into display lines, skipping file metadata headers.
 * @param diffText The unified diff text to parse
 * @returns The parsed diff lines, or an empty array when no diff text is provided
 */
export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  if (!diffText) {
    return [];
  }

  const lines = splitIntoLines(diffText);
  const diff: DiffLine[] = [];

  for (const line of lines) {
    if (!line.length) {
      diff.push({ type: "context", content: line });
      continue;
    }

    if (line.startsWith("@@")) {
      diff.push({ type: "header", content: line });
      continue;
    }

    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) {
        diff.push({ type: "add", content: line });
      }
      continue;
    }

    if (line.startsWith("-")) {
      if (!line.startsWith("---")) {
        diff.push({ type: "remove", content: line });
      }
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    if (line.startsWith("\\ No newline")) {
      diff.push({ type: "header", content: line });
      continue;
    }

    diff.push({ type: "context", content: line });
  }

  return diff;
}

// ---- Task Extraction (cross-provider) ----

/** Status of a task extracted from a tool call, normalized across providers. */
export type TaskStatus = "pending" | "in_progress" | "completed";

/** A single task extracted from a provider's todo or plan tool call. */
export interface TaskEntry {
  text: string;
  status: TaskStatus;
  completed: boolean;
}

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const ClaudeTodoWriteSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      status: TaskStatusSchema,
      activeForm: z.string().optional(),
    }),
  ),
});

const UpdatePlanSchema = z.object({
  plan: z.array(
    z.object({
      step: z.string(),
      status: TaskStatusSchema.catch("pending"),
    }),
  ),
});

function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[.\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Extracts task entries from a provider tool call such as TodoWrite or update_plan.
 * @param toolName The tool name as reported by the provider
 * @param input The raw tool call input payload
 * @returns The normalized task entries, or null when the tool call is not a task list or fails validation
 */
export function extractTaskEntriesFromToolCall(
  toolName: string,
  input: unknown,
): TaskEntry[] | null {
  const normalized = normalizeToolName(toolName);

  // Claude's plan mode uses ExitPlanMode for the approval prompt; it is not a task list.
  if (normalized === "exitplanmode") {
    return null;
  }

  if (normalized === "todowrite" || normalized === "todo_write") {
    const parsed = ClaudeTodoWriteSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.todos.map((todo) => {
      const status = todo.status;
      const text = todo.activeForm?.trim() || todo.content.trim();
      return {
        text: text.length ? text : todo.content,
        status,
        completed: status === "completed",
      };
    });
  }

  if (normalized === "update_plan") {
    const parsed = UpdatePlanSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.plan
      .map((entry) => ({
        text: entry.step.trim(),
        status: entry.status,
        completed: entry.status === "completed",
      }))
      .filter((entry) => entry.text.length > 0);
  }

  return null;
}
