/**
 * Shared markdown utilities for message rendering across web and native.
 *
 * These are pure functions used by both the web (react-markdown) and native
 * (react-native-markdown-display) renderers to handle common AI output
 * patterns consistently.
 *
 * Design adapted from Cindy's MarkdownRenderer plugins (Apache-2.0).
 */

// ── CJK URL truncation ─────────────────────────────────────────────────────

/**
 * CJK and fullwidth characters that GFM autolink incorrectly swallows into
 * URLs. Example: `https://x.com/foo（中文` — GFM treats `（中文` as part of
 * the URL. This regex matches the boundary characters to split them back out.
 */
const CJK_URL_BOUNDARY_RE =
  /[（）【】「」『』《》〈〉、。！？；：，．：；！？（）｛｝〔〕～｜“”‘’]|[　-〿一-鿿豈-﫿＀-￯]/;

/**
 * Split a URL string at the first CJK/fullwidth character boundary.
 * Returns [url, trailing] where trailing is the CJK text that was
 * incorrectly attached to the URL.
 *
 * Returns [input, ""] when no CJK boundary is found.
 */
export function truncateCjkUrl(input: string): [string, string] {
  const match = CJK_URL_BOUNDARY_RE.exec(input);
  if (!match || match.index === 0) return [input, ""];
  return [input.slice(0, match.index), input.slice(match.index)];
}

// ── Code block language detection ──────────────────────────────────────────

/** Known diff-like language tags that should use diff rendering. */
const DIFF_LANGUAGES = new Set(["diff", "patch", "udiff"]);

/** Known diagram language tags that should use diagram rendering. */
const DIAGRAM_LANGUAGES = new Set(["mermaid", "plantuml", "graphviz", "dot"]);

/**
 * Classify a fenced code block's language tag for specialized rendering.
 */
export function classifyCodeBlock(
  language: string | undefined,
): "diff" | "diagram" | "math" | "code" {
  if (!language) return "code";
  const lower = language.toLowerCase().trim();
  if (DIFF_LANGUAGES.has(lower)) return "diff";
  if (DIAGRAM_LANGUAGES.has(lower)) return "diagram";
  if (lower === "math" || lower === "latex" || lower === "tex") return "math";
  return "code";
}

// ── Diff line parsing ──────────────────────────────────────────────────────

export type DiffLineKind = "add" | "delete" | "context" | "header" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number in the old file (null for additions). */
  oldLine: number | null;
  /** Line number in the new file (null for deletions). */
  newLine: number | null;
  /** The content after the +/-/space prefix. */
  content: string;
  /** The raw line including prefix. */
  raw: string;
}

/**
 * Parse a unified diff string into structured lines with line numbers.
 */
export function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number.parseInt(match[1], 10);
        newLine = Number.parseInt(match[2], 10);
      }
      result.push({ kind: "header", oldLine: null, newLine: null, content: raw, raw });
      continue;
    }

    if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("index ")) {
      result.push({ kind: "meta", oldLine: null, newLine: null, content: raw, raw });
      continue;
    }

    if (raw.startsWith("+")) {
      result.push({ kind: "add", oldLine: null, newLine, content: raw.slice(1), raw });
      newLine++;
    } else if (raw.startsWith("-")) {
      result.push({ kind: "delete", oldLine, newLine: null, content: raw.slice(1), raw });
      oldLine++;
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      result.push({ kind: "context", oldLine, newLine, content, raw });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

// ── Inline math detection ──────────────────────────────────────────────────

/**
 * Check if a text segment likely contains inline math ($...$) vs currency.
 * Uses the same heuristic as Cindy's remarkStrictInlineMath: requires
 * matching delimiters with non-whitespace content between them, and the
 * closing $ must not be followed by a digit (which would indicate currency
 * like "$5 $10").
 */
export function hasInlineMath(text: string): boolean {
  return /\$(?!\s)((?:[^$\\]|\\.)+?)(?<!\s)\$(?!\d)/.test(text);
}
