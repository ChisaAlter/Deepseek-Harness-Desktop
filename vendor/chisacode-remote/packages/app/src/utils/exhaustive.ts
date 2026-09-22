/**
 * Exhaustiveness helper that throws when an unexpected switch case is reached
 * @param value Value that TypeScript believes is unreachable
 * @returns Never; always throws
 * @throws {Error} Always, with the unhandled value stringified
 */
export function assertUnreachable(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
