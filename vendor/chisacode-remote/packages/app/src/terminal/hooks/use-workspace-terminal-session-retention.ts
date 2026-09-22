import { useEffect } from "react";
import {
  releaseWorkspaceTerminalSession,
  retainWorkspaceTerminalSession,
} from "@/terminal/runtime/workspace-terminal-session";

export function useWorkspaceTerminalSessionRetention(input: { scopeKey: string | null }): void {
  useEffect(() => {
    const scopeKey = input.scopeKey;
    if (!scopeKey) {
      return;
    }

    retainWorkspaceTerminalSession({ scopeKey });
    return () => {
      releaseWorkspaceTerminalSession({ scopeKey });
    };
  }, [input.scopeKey]);
}
