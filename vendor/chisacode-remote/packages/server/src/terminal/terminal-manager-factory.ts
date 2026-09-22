import type { TerminalManager } from "./terminal-manager.js";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";

export function createConfiguredTerminalManager(workspaceWriteCoordinator?: {
  assertAcceptingWrites(path: string, operation: string): void;
  runWithWriteLease<T>(path: string, operation: string, fn: () => Promise<T>): Promise<T>;
}): TerminalManager {
  return createWorkerTerminalManager({ workspaceWriteCoordinator });
}
