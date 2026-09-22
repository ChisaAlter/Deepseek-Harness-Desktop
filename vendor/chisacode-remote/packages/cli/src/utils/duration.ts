/**
 * Parse duration string to milliseconds.
 * Supports formats like: 5m, 30s, 1h, 2h30m, 1.5h, 90, etc.
 * If no unit is specified, assumes seconds.
 * The whole string must be a valid duration; trailing garbage is rejected
 * instead of being silently ignored (e.g. "1.5h" is 1.5 hours, not 5).
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim();

  // If it's just a number, treat as seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }

  // Parse duration with units. The anchored pattern rejects partial matches:
  // "5m30" (missing unit on the tail) and "1.5" without a unit are errors.
  const unitPattern = /\d+(?:\.\d+)?[smh]/;
  if (!new RegExp(`^(${unitPattern.source})+$`).test(trimmed)) {
    throw new Error(
      `Invalid duration format: ${input}. Use formats like: 5m, 30s, 1h, 2h30m or a plain number of seconds`,
    );
  }

  let totalMs = 0;
  const regex = /(\d+(?:\.\d+)?)([smh])/g;
  let match;

  while ((match = regex.exec(trimmed)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];

    switch (unit) {
      case "s":
        totalMs += value * 1000;
        break;
      case "m":
        totalMs += value * 60 * 1000;
        break;
      case "h":
        totalMs += value * 60 * 60 * 1000;
        break;
    }
  }

  return Math.round(totalMs);
}
