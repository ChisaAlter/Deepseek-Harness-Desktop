import { highlightCode, isLanguageSupported, type HighlightToken } from "@chisacode/highlight";

/** One line inside a parsed unified-diff hunk, optionally with syntax tokens */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  lineNumber?: number; // Line number in the original/new file
  tokens?: HighlightToken[];
}

/** A unified-diff hunk with old/new ranges and parsed content lines */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Structured representation of one file section from a multi-file unified diff */
export interface ParsedDiffFile {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const DIFF_METADATA_PREFIXES = ["index ", "--- ", "+++ ", "new file mode", "deleted file mode"];

function isDiffMetadataLine(line: string): boolean {
  return DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

// Git's default patch headers use paired a/path and b/path prefixes, while
// diff.noprefix emits plain paths that may legitimately start with a/ or b/.
function usesDiffPathPrefixes(oldPath: string, newPath: string): boolean {
  return oldPath.startsWith("a/") && newPath.startsWith("b/");
}

function extractPathFromMetadata(lines: string[], prefix: "--- " | "+++ "): string | null {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    return null;
  }

  const path = line.slice(prefix.length).replace(/\t.*$/, "").trimEnd();
  return path === "/dev/null" ? null : path;
}

function extractDiffPath(lines: string[]): string {
  const firstLine = lines[0] ?? "";
  const prefixedPathMatch = firstLine.match(/^a\/(.+) b\/(.+)$/);
  if (prefixedPathMatch) {
    return prefixedPathMatch[2];
  }

  const metadataPath =
    extractPathFromMetadata(lines, "+++ ") ?? extractPathFromMetadata(lines, "--- ");
  if (metadataPath) {
    return metadataPath;
  }

  const pathMatch = firstLine.match(/^(\S+)\s+(\S+)$/);
  if (pathMatch) {
    const [, oldPath, newPath] = pathMatch;
    const path = newPath === "/dev/null" ? oldPath : newPath;
    return usesDiffPathPrefixes(oldPath, newPath) ? path.slice(2) : path;
  }
  return "unknown";
}

function pushContentLine(hunk: DiffHunk, line: string): { addition: number; deletion: number } {
  if (line.startsWith("+")) {
    hunk.lines.push({ type: "add", content: line.slice(1) });
    return { addition: 1, deletion: 0 };
  }
  if (line.startsWith("-")) {
    hunk.lines.push({ type: "remove", content: line.slice(1) });
    return { addition: 0, deletion: 1 };
  }
  if (line.startsWith(" ")) {
    hunk.lines.push({ type: "context", content: line.slice(1) });
    return { addition: 0, deletion: 0 };
  }
  if (line.length > 0 && !line.startsWith("\\")) {
    hunk.lines.push({ type: "context", content: line });
  }
  return { addition: 0, deletion: 0 };
}

interface HunkParseResult {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function parseHunks(lines: string[]): HunkParseResult {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (isDiffMetadataLine(line)) continue;

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [{ type: "header", content: line.match(/^(@@ .+? @@)/)?.[1] ?? line }],
      };
      continue;
    }

    if (!currentHunk) continue;

    const delta = pushContentLine(currentHunk, line);
    additions += delta.addition;
    deletions += delta.deletion;
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return { hunks, additions, deletions };
}

/**
 * Parses a unified multi-file diff into structured per-file data
 * @param diffText Raw unified diff text, typically from git
 * @returns Parsed files with hunks and add/delete counts; empty when input is blank
 */
export function parseDiff(diffText: string): ParsedDiffFile[] {
  if (!diffText || diffText.trim().length === 0) {
    return [];
  }

  const files: ParsedDiffFile[] = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    const isNew = section.includes("new file mode") || section.includes("--- /dev/null");
    const isDeleted = section.includes("deleted file mode") || section.includes("+++ /dev/null");
    const path = extractDiffPath(lines);
    const { hunks, additions, deletions } = parseHunks(lines);

    files.push({ path, isNew, isDeleted, additions, deletions, hunks });
  }

  return files;
}

/**
 * Reconstructs the "new" version of a file from diff hunks
 * @param hunks Parsed hunks for a single file
 * @returns Map of new-file line numbers to line content
 */
export function reconstructNewFile(hunks: DiffHunk[]): Map<number, string> {
  const lines = new Map<number, string>();

  for (const hunk of hunks) {
    let newLineNum = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.type === "header") continue;

      if (line.type === "add" || line.type === "context") {
        lines.set(newLineNum, line.content);
        newLineNum++;
      }
      // Remove lines don't appear in the new file
    }
  }

  return lines;
}

/**
 * Reconstructs the "old" version of a file from diff hunks
 * @param hunks Parsed hunks for a single file
 * @returns Map of old-file line numbers to line content
 */
export function reconstructOldFile(hunks: DiffHunk[]): Map<number, string> {
  const lines = new Map<number, string>();

  for (const hunk of hunks) {
    let oldLineNum = hunk.oldStart;

    for (const line of hunk.lines) {
      if (line.type === "header") continue;

      if (line.type === "remove" || line.type === "context") {
        lines.set(oldLineNum, line.content);
        oldLineNum++;
      }
      // Add lines don't appear in the old file
    }
  }

  return lines;
}

/**
 * Applies syntax highlighting to a parsed diff file's hunk lines.
 *
 * Strategy:
 * 1. Reconstruct both old and new file versions from the hunks
 * 2. Highlight each version as a complete file
 * 3. Map highlighted tokens back to diff lines using line numbers
 * @param file Parsed diff file whose language is inferred from path
 * @returns A copy of the file with tokens attached when the language is supported
 */
export function highlightDiffFile(file: ParsedDiffFile): ParsedDiffFile {
  if (!isLanguageSupported(file.path)) {
    return file;
  }

  // Reconstruct both versions
  const newFileLines = reconstructNewFile(file.hunks);
  const oldFileLines = reconstructOldFile(file.hunks);

  // Build complete file content strings for highlighting
  const newFileContent = buildFileContent(newFileLines);
  const oldFileContent = buildFileContent(oldFileLines);

  // Highlight both versions
  const newHighlighted = highlightCode(newFileContent, file.path);
  const oldHighlighted = highlightCode(oldFileContent, file.path);

  // Build lookup maps: line number -> tokens
  const newTokensByLine = buildTokenLookup(newFileLines, newHighlighted);
  const oldTokensByLine = buildTokenLookup(oldFileLines, oldHighlighted);

  // Apply tokens to hunks
  const highlightedHunks = file.hunks.map((hunk) => {
    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    const highlightedLines = hunk.lines.map((line): DiffLine => {
      if (line.type === "header") {
        return line;
      }

      let tokens: HighlightToken[] | undefined;

      if (line.type === "add") {
        tokens = newTokensByLine.get(newLineNum);
        newLineNum++;
      } else if (line.type === "remove") {
        tokens = oldTokensByLine.get(oldLineNum);
        oldLineNum++;
      } else if (line.type === "context") {
        // Context lines exist in both - use new file version
        tokens = newTokensByLine.get(newLineNum);
        oldLineNum++;
        newLineNum++;
      }

      return tokens ? { ...line, tokens } : line;
    });

    return { ...hunk, lines: highlightedLines };
  });

  return { ...file, hunks: highlightedHunks };
}

function buildFileContent(lineMap: Map<number, string>): string {
  if (lineMap.size === 0) return "";

  const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const minLine = lineNumbers[0];
  const maxLine = lineNumbers[lineNumbers.length - 1];

  const lines: string[] = [];
  for (let i = minLine; i <= maxLine; i++) {
    lines.push(lineMap.get(i) ?? "");
  }

  return lines.join("\n");
}

function buildTokenLookup(
  lineMap: Map<number, string>,
  highlighted: HighlightToken[][],
): Map<number, HighlightToken[]> {
  const lookup = new Map<number, HighlightToken[]>();

  if (lineMap.size === 0) return lookup;

  const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const minLine = lineNumbers[0];

  // highlighted array is 0-indexed, line numbers are 1-indexed
  for (let i = 0; i < highlighted.length; i++) {
    const lineNum = minLine + i;
    if (lineMap.has(lineNum)) {
      lookup.set(lineNum, highlighted[i]);
    }
  }

  return lookup;
}

/**
 * Parses a unified diff and applies syntax highlighting to each file
 * @param diffText Raw unified diff text
 * @returns Parsed files with highlighted tokens where languages are supported
 */
export function parseAndHighlightDiff(diffText: string): ParsedDiffFile[] {
  const files = parseDiff(diffText);
  return files.map(highlightDiffFile);
}
