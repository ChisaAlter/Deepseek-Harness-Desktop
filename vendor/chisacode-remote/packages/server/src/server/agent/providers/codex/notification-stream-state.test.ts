import { describe, expect, test } from "vitest";

import { CodexNotificationStreamState } from "./notification-stream-state.js";

describe("Codex notification stream state", () => {
  test("buffers and consumes assistant, reasoning, command, and file output independently", () => {
    const state = new CodexNotificationStreamState();

    expect(state.appendAssistantDelta("assistant", "Hel")).toEqual({
      previous: "",
      text: "Hel",
    });
    expect(state.appendAssistantDelta("assistant", "lo")).toEqual({
      previous: "Hel",
      text: "Hello",
    });
    expect(state.appendReasoningDelta("reasoning", "Think")).toBe("Think");
    expect(state.appendReasoningDelta("reasoning", "ing")).toBe("Thinking");
    state.appendCommandOutput("command", "one");
    state.appendCommandOutput("command", "two");
    state.appendFileChangeOutput("file", "patch");

    expect(state.consumeAssistantText("assistant")).toBe("Hello");
    expect(state.consumeReasoningText("reasoning")).toBe("Thinking");
    expect(state.consumeCommandOutput("command")).toBe("onetwo");
    expect(state.consumeFileChangeOutput("file")).toBe("patch");
  });

  test("tracks lifecycle dedupe and clears turn-scoped state", () => {
    const state = new CodexNotificationStreamState();
    state.markItemStarted("item");
    state.markItemCompleted("item");
    state.markExecCommandStarted("command");
    state.markExecCommandCompleted("command");
    expect(state.shouldWarnIncompleteEdit("item:edit")).toBe(true);
    expect(state.shouldWarnIncompleteEdit("item:edit")).toBe(false);

    state.resetTurn();

    expect(state.hasItemStarted("item")).toBe(false);
    expect(state.hasItemCompleted("item")).toBe(false);
    expect(state.hasExecCommandStarted("command")).toBe(false);
    expect(state.hasExecCommandCompleted("command")).toBe(false);
    expect(state.shouldWarnIncompleteEdit("item:edit")).toBe(true);
  });

  test("correlates late terminal commands and deduplicates interactions", () => {
    const state = new CodexNotificationStreamState();
    state.markPendingTerminalInteraction("42");

    expect(state.rememberTerminalCommand("42", "npm test")).toBe(true);
    expect(state.resolveTerminalCommand("42")).toBe("npm test");
    expect(state.rememberTerminalCommand("43", "npm lint")).toBe(false);
    expect(state.shouldEmitTerminalInteraction("42\0stdin")).toBe(true);
    expect(state.shouldEmitTerminalInteraction("42\0stdin")).toBe(false);
  });
});
