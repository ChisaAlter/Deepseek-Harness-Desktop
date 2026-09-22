import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWorkspaceTerminalSession,
  releaseWorkspaceTerminalSession,
  retainWorkspaceTerminalSession,
} from "./workspace-terminal-session";

describe("workspace-terminal-session", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the same workspace session instance for the same scope", () => {
    const first = getWorkspaceTerminalSession({
      scopeKey: "workspace-a",
    });
    const second = getWorkspaceTerminalSession({
      scopeKey: "workspace-a",
    });

    expect(second).toBe(first);
  });

  it("preserves snapshots across repeated lookups", () => {
    const first = getWorkspaceTerminalSession({
      scopeKey: "workspace-snapshots",
    });
    first.snapshots.set({
      terminalId: "term-1",
      state: {
        rows: 1,
        cols: 1,
        grid: [[{ char: "A" }]],
        scrollback: [],
        cursor: { row: 0, col: 0 },
      },
    });

    const second = getWorkspaceTerminalSession({
      scopeKey: "workspace-snapshots",
    });

    expect(second.snapshots.get({ terminalId: "term-1" })).toEqual({
      rows: 1,
      cols: 1,
      grid: [[{ char: "A" }]],
      scrollback: [],
      cursor: { row: 0, col: 0 },
    });
  });

  it("reuses the session within the release grace period (Strict Mode remount safety)", () => {
    const scopeKey = "workspace-grace-reuse";
    const first = getWorkspaceTerminalSession({ scopeKey });
    first.snapshots.set({
      terminalId: "term-1",
      state: {
        rows: 1,
        cols: 1,
        grid: [[{ char: "A" }]],
        scrollback: [],
        cursor: { row: 0, col: 0 },
      },
    });

    retainWorkspaceTerminalSession({ scopeKey });
    releaseWorkspaceTerminalSession({ scopeKey });

    // A rapid re-mount (e.g. Strict Mode dev mount→unmount→mount) should
    // revive the existing session and preserve scrollback, not create a new one.
    const second = getWorkspaceTerminalSession({ scopeKey });
    expect(second).toBe(first);
    expect(second.snapshots.get({ terminalId: "term-1" })).toEqual({
      rows: 1,
      cols: 1,
      grid: [[{ char: "A" }]],
      scrollback: [],
      cursor: { row: 0, col: 0 },
    });
  });

  it("evicts workspace terminal session state after the release grace period elapses", () => {
    vi.useFakeTimers();
    const scopeKey = "workspace-release-timeout";
    const first = getWorkspaceTerminalSession({ scopeKey });
    first.snapshots.set({
      terminalId: "term-1",
      state: {
        rows: 1,
        cols: 1,
        grid: [[{ char: "A" }]],
        scrollback: [],
        cursor: { row: 0, col: 0 },
      },
    });

    retainWorkspaceTerminalSession({ scopeKey });
    releaseWorkspaceTerminalSession({ scopeKey });

    // Advance past the grace period so the pending teardown fires without a
    // intervening getWorkspaceTerminalSession call (which would cancel it).
    vi.advanceTimersByTime(6_000);

    const second = getWorkspaceTerminalSession({ scopeKey });
    expect(second).not.toBe(first);
    expect(second.snapshots.get({ terminalId: "term-1" })).toBeNull();
  });
});
