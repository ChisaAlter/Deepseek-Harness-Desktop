/**
 * Render an arbitrary thrown value for inline form errors.
 * @param error - the thrown value.
 * @returns a message string safe to display.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
