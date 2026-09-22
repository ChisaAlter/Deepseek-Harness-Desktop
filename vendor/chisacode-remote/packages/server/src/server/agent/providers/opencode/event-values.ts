/** Reads a non-array object record from an OpenCode SDK payload. */
export function readOpenCodeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads and trims a non-empty string from an OpenCode SDK payload. */
export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
