import path from "node:path";

/**
 * Resolves a target path and rejects paths outside the configured workspace.
 * This is an intent constraint for ACP file and terminal requests, not an OS sandbox.
 * @param target Requested path
 * @param base Workspace root
 * @returns Resolved path inside the workspace
 * @throws If the resolved path escapes the workspace root
 */
export function resolvePathInsideBase(target: string, base: string): string {
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  const relative = path.relative(resolvedBase, resolvedTarget);
  const escapesBase = relative === ".." || relative.startsWith(`..${path.sep}`);
  if (escapesBase || path.isAbsolute(relative)) {
    throw new Error(`Path "${target}" escapes the project directory "${base}"`);
  }
  return resolvedTarget;
}
