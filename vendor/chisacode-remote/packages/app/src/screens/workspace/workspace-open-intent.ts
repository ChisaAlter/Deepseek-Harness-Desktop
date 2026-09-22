import { isWorkspaceScreenOpenIntent, parseWorkspaceOpenIntent } from "@/utils/host-routes";

export type WorkspaceScreenOpenIntentAction =
  | { kind: "ignore" }
  | { kind: "wait" }
  | { kind: "open-changes" }
  | { kind: "create-terminal" };

export function resolveWorkspaceScreenOpenIntentAction(input: {
  openIntentValue: string;
  hasExplorerCheckout: boolean;
  isTerminalCreatePending: boolean;
}): WorkspaceScreenOpenIntentAction {
  const intent = parseWorkspaceOpenIntent(input.openIntentValue);
  if (!intent || !isWorkspaceScreenOpenIntent(intent)) {
    return { kind: "ignore" };
  }
  if (intent.kind === "changes") {
    return input.hasExplorerCheckout ? { kind: "open-changes" } : { kind: "wait" };
  }
  return input.isTerminalCreatePending ? { kind: "wait" } : { kind: "create-terminal" };
}
