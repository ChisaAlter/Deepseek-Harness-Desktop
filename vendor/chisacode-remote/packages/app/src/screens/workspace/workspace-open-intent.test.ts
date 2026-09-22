import { describe, expect, it } from "vitest";
import { resolveWorkspaceScreenOpenIntentAction } from "./workspace-open-intent";

describe("resolveWorkspaceScreenOpenIntentAction", () => {
  it("waits to open changes until the explorer checkout is available", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "changes:review",
        hasExplorerCheckout: false,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("opens changes when the explorer checkout is available", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "changes:review",
        hasExplorerCheckout: true,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "open-changes" });
  });

  it("normalizes fixed workspace screen intent payloads", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "changes:Review",
        hasExplorerCheckout: true,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "open-changes" });
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "terminal:NEW",
        hasExplorerCheckout: false,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "create-terminal" });
  });

  it("accepts short workspace screen intent aliases", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "changes",
        hasExplorerCheckout: true,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "open-changes" });
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: " terminal ",
        hasExplorerCheckout: false,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "create-terminal" });
  });

  it("waits for short terminal aliases while terminal creation is pending", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "terminal",
        hasExplorerCheckout: false,
        isTerminalCreatePending: true,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("waits to create a terminal while terminal creation is pending", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "terminal:new",
        hasExplorerCheckout: false,
        isTerminalCreatePending: true,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("creates a terminal when terminal creation is available", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "terminal:new",
        hasExplorerCheckout: false,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "create-terminal" });
  });

  it("ignores non-screen workspace intents", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "agent:agent-1",
        hasExplorerCheckout: true,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores malformed changes intents", () => {
    expect(
      resolveWorkspaceScreenOpenIntentAction({
        openIntentValue: "changes:unknown",
        hasExplorerCheckout: true,
        isTerminalCreatePending: false,
      }),
    ).toEqual({ kind: "ignore" });
  });
});
