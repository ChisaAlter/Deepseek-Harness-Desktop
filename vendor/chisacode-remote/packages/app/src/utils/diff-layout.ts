import type { DiffLine, ParsedDiffFile } from "@/git/use-diff-query";

type ReviewSide = "old" | "new";
type ReviewableLineType = "add" | "remove" | "context";

/** Input identifying a single reviewable line within a diff file by side and line number. */
export interface ReviewableDiffTargetKeyInput {
  filePath: string;
  side: ReviewSide;
  lineNumber: number;
}

/** A single diff line that can receive review comments, with its position inside the file and hunk. */
export interface ReviewableDiffTarget {
  key: string;
  filePath: string;
  hunkHeader: string;
  hunkIndex: number;
  lineIndex: number;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  side: ReviewSide;
  lineNumber: number;
  lineType: ReviewableLineType;
  content: string;
}

/**
 * Builds the stable key used to identify a reviewable diff line.
 * @param input The file path, side, and line number identifying the line
 * @returns A composite key in the form "filePath:side:lineNumber"
 */
export function buildReviewableDiffTargetKey(input: ReviewableDiffTargetKeyInput): string {
  return `${input.filePath}:${input.side}:${input.lineNumber}`;
}

/** A reviewable diff target paired with the underlying parsed diff line. */
export interface NumberedDiffCell extends ReviewableDiffTarget {
  line: DiffLine;
}

/** A diff line annotated with old/new line numbers and per-side reviewable cells. */
export interface NumberedDiffLine {
  key: string;
  filePath: string;
  hunkHeader: string;
  hunkIndex: number;
  lineIndex: number;
  line: DiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  unifiedCell: NumberedDiffCell | null;
  oldCell: NumberedDiffCell | null;
  newCell: NumberedDiffCell | null;
}

/** A diff hunk with its header and line-numbered rows. */
export interface NumberedDiffHunk {
  hunkIndex: number;
  hunkHeader: string;
  lines: NumberedDiffLine[];
}

/** A displayable line on one side of a split diff view, with its review target when reviewable. */
export interface SplitDiffDisplayLine {
  type: DiffLine["type"];
  content: string;
  tokens?: DiffLine["tokens"];
  lineNumber: number | null;
  reviewTarget: ReviewableDiffTarget | null;
}

/** A displayable line in a unified diff view, with its review target when reviewable. */
export interface UnifiedDiffDisplayLine {
  key: string;
  line: DiffLine;
  lineNumber: number | null;
  reviewTarget: ReviewableDiffTarget | null;
}

/** A row in a split diff view: either a hunk header or a paired left/right line. */
export type SplitDiffRow =
  | {
      kind: "header";
      content: string;
    }
  | {
      kind: "pair";
      left: SplitDiffDisplayLine | null;
      right: SplitDiffDisplayLine | null;
    };

function toSplitDisplayLine(cell: NumberedDiffCell | null): SplitDiffDisplayLine | null {
  if (!cell) {
    return null;
  }

  return {
    type: cell.lineType,
    content: cell.content,
    ...(cell.line.tokens ? { tokens: cell.line.tokens } : {}),
    lineNumber: cell.lineNumber,
    reviewTarget: toReviewTarget(cell),
  };
}

function toReviewTarget(cell: NumberedDiffCell): ReviewableDiffTarget {
  return {
    key: cell.key,
    filePath: cell.filePath,
    hunkHeader: cell.hunkHeader,
    hunkIndex: cell.hunkIndex,
    lineIndex: cell.lineIndex,
    oldLineNumber: cell.oldLineNumber,
    newLineNumber: cell.newLineNumber,
    side: cell.side,
    lineNumber: cell.lineNumber,
    lineType: cell.lineType,
    content: cell.content,
  };
}

function getHunkHeader(hunk: ParsedDiffFile["hunks"][number]): string {
  const headerLine = hunk.lines.find((line) => line.type === "header");
  return headerLine?.content ?? "@@";
}

/**
 * Annotates every line of a parsed diff file with old/new line numbers and reviewable cells.
 * @param file The parsed diff file to annotate
 * @returns The hunks with line-numbered rows
 */
export function buildNumberedDiffHunks(file: ParsedDiffFile): NumberedDiffHunk[] {
  const numberedHunks: NumberedDiffHunk[] = [];
  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    let oldLineNo = hunk.oldStart;
    let newLineNo = hunk.newStart;
    const hunkHeader = getHunkHeader(hunk);
    const lines: NumberedDiffLine[] = [];

    for (const [lineIndex, line] of hunk.lines.entries()) {
      let oldLineNumber: number | null = null;
      let newLineNumber: number | null = null;

      if (line.type === "remove") {
        oldLineNumber = oldLineNo;
        oldLineNo += 1;
      } else if (line.type === "add") {
        newLineNumber = newLineNo;
        newLineNo += 1;
      } else if (line.type === "context") {
        oldLineNumber = oldLineNo;
        newLineNumber = newLineNo;
        oldLineNo += 1;
        newLineNo += 1;
      }

      const oldCell = buildNumberedCell({
        filePath: file.path,
        hunkHeader,
        hunkIndex,
        lineIndex,
        line,
        oldLineNumber,
        newLineNumber,
        side: "old",
      });
      const newCell = buildNumberedCell({
        filePath: file.path,
        hunkHeader,
        hunkIndex,
        lineIndex,
        line,
        oldLineNumber,
        newLineNumber,
        side: "new",
      });

      lines.push({
        key: `${hunkIndex}-${lineIndex}`,
        filePath: file.path,
        hunkHeader,
        hunkIndex,
        lineIndex,
        line,
        oldLineNumber,
        newLineNumber,
        unifiedCell: line.type === "remove" ? oldCell : newCell,
        oldCell,
        newCell,
      });
    }

    numberedHunks.push({ hunkIndex, hunkHeader, lines });
  }

  return numberedHunks;
}

function buildNumberedCell(input: {
  filePath: string;
  hunkHeader: string;
  hunkIndex: number;
  lineIndex: number;
  line: DiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  side: ReviewSide;
}): NumberedDiffCell | null {
  if (input.line.type === "header") {
    return null;
  }
  if (input.line.type === "remove" && input.side !== "old") {
    return null;
  }
  if (input.line.type === "add" && input.side !== "new") {
    return null;
  }

  const lineNumber = input.side === "old" ? input.oldLineNumber : input.newLineNumber;
  if (lineNumber === null) {
    return null;
  }

  return {
    key: buildReviewableDiffTargetKey({
      filePath: input.filePath,
      side: input.side,
      lineNumber,
    }),
    filePath: input.filePath,
    hunkHeader: input.hunkHeader,
    hunkIndex: input.hunkIndex,
    lineIndex: input.lineIndex,
    oldLineNumber: input.oldLineNumber,
    newLineNumber: input.newLineNumber,
    side: input.side,
    lineNumber,
    lineType: input.line.type,
    content: input.line.content,
    line: input.line,
  };
}

/**
 * Flattens a parsed diff file into display lines for a unified diff view.
 * @param file The parsed diff file to render
 * @returns The display lines with line numbers and review targets
 */
export function buildUnifiedDiffLines(file: ParsedDiffFile): UnifiedDiffDisplayLine[] {
  return buildNumberedDiffHunks(file).flatMap((hunk) =>
    hunk.lines.map((numberedLine) => ({
      key: numberedLine.key,
      line: numberedLine.line,
      lineNumber: numberedLine.unifiedCell?.lineNumber ?? null,
      reviewTarget: numberedLine.unifiedCell ? toReviewTarget(numberedLine.unifiedCell) : null,
    })),
  );
}

/**
 * Lays out a parsed diff file as paired left/right rows for a split diff view.
 * @param file The parsed diff file to render
 * @returns The ordered header and pair rows of the split view
 */
export function buildSplitDiffRows(file: ParsedDiffFile): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];

  for (const hunk of buildNumberedDiffHunks(file)) {
    rows.push({
      kind: "header",
      content: hunk.hunkHeader,
    });

    let pendingRemovals: NumberedDiffCell[] = [];
    let pendingAdditions: NumberedDiffCell[] = [];

    const flushPendingRows = () => {
      const pairCount = Math.max(pendingRemovals.length, pendingAdditions.length);
      for (let index = 0; index < pairCount; index += 1) {
        const removal = pendingRemovals[index] ?? null;
        const addition = pendingAdditions[index] ?? null;
        rows.push({
          kind: "pair",
          left: toSplitDisplayLine(removal),
          right: toSplitDisplayLine(addition),
        });
      }
      pendingRemovals = [];
      pendingAdditions = [];
    };

    for (const numberedLine of hunk.lines) {
      if (numberedLine.line.type === "header") {
        continue;
      }

      if (numberedLine.line.type === "remove") {
        if (numberedLine.oldCell) {
          pendingRemovals.push(numberedLine.oldCell);
        }
        continue;
      }

      if (numberedLine.line.type === "add") {
        if (numberedLine.newCell) {
          pendingAdditions.push(numberedLine.newCell);
        }
        continue;
      }

      flushPendingRows();

      if (numberedLine.line.type === "context") {
        rows.push({
          kind: "pair",
          left: toSplitDisplayLine(numberedLine.oldCell),
          right: toSplitDisplayLine(numberedLine.newCell),
        });
      }
    }

    flushPendingRows();
  }

  return rows;
}
