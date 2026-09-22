/** Returns whether an unknown Pi payload is a non-array record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string value without coercion. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads a boolean value without coercion. */
export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Filters an unknown array to its string entries. */
export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
