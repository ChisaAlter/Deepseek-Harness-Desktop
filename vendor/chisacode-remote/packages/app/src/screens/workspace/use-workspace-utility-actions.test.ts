import { describe, expect, test } from "vitest";
import { resolveAgentResumeCommand } from "./workspace-utility-actions";

describe("resolveAgentResumeCommand", () => {
  test("prefers the live runtime session id", () => {
    expect(
      resolveAgentResumeCommand({
        provider: "codex",
        runtimeInfo: { sessionId: "live-session" },
        persistence: { sessionId: "persisted-session" },
      }),
    ).toEqual({ ok: true, command: "codex resume live-session" });
  });

  test("falls back to the persisted provider session id", () => {
    expect(
      resolveAgentResumeCommand({
        provider: "claude",
        runtimeInfo: { sessionId: null },
        persistence: { sessionId: "persisted-session" },
      }),
    ).toEqual({ ok: true, command: "claude --resume persisted-session" });
  });

  test("distinguishes a missing session from an unsupported provider command", () => {
    expect(resolveAgentResumeCommand(null)).toEqual({
      ok: false,
      reason: "session-unavailable",
    });
    expect(
      resolveAgentResumeCommand({
        provider: "mock",
        runtimeInfo: { sessionId: "session-1" },
      }),
    ).toEqual({ ok: false, reason: "command-unavailable" });
  });
});
