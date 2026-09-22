import { describe, expect, it, vi } from "vitest";
import { runDesktopStartup } from "./desktop-startup";

function noopAsync() {
  return Promise.resolve();
}

function noopSync() {}

describe("desktop startup", () => {
  it("runs CLI passthrough before GUI login-shell env inheritance", async () => {
    const calls: string[] = [];
    await runDesktopStartup({
      hasPendingOpenProjectPath: false,
      runCliPassthroughIfRequested: vi.fn(async () => {
        calls.push("cli");
        return true;
      }),
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      inheritLoginShellEnvAsync: noopAsync,
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });

    expect(calls).toEqual(["cli"]);
  });

  it("keeps login-shell env inheritance on normal GUI startup", async () => {
    const calls: string[] = [];
    await runDesktopStartup({
      hasPendingOpenProjectPath: false,
      runCliPassthroughIfRequested: vi.fn(async () => {
        calls.push("cli");
        return false;
      }),
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      inheritLoginShellEnvAsync: noopAsync,
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });

    expect(calls).toEqual(["cli", "env", "gui"]);
  });

  it("does not route open-project launches through CLI passthrough", async () => {
    const runCliPassthroughIfRequested = vi.fn(async () => true);
    const calls: string[] = [];

    await runDesktopStartup({
      hasPendingOpenProjectPath: true,
      runCliPassthroughIfRequested,
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      inheritLoginShellEnvAsync: noopAsync,
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });

    expect(runCliPassthroughIfRequested).not.toHaveBeenCalled();
    expect(calls).toEqual(["env", "gui"]);
  });

  it("runs login-shell env async and GUI bootstrap in parallel", async () => {
    const events: string[] = [];
    let resolveEnv: () => void = noopSync;
    let resolveGui: () => void = noopSync;

    const envPromise = new Promise<void>((r) => {
      resolveEnv = () => {
        events.push("env-async-done");
        r();
      };
    });
    const guiPromise = new Promise<void>((r) => {
      resolveGui = () => {
        events.push("gui-done");
        r();
      };
    });

    const started = runDesktopStartup({
      hasPendingOpenProjectPath: false,
      runCliPassthroughIfRequested: vi.fn(async () => {
        events.push("cli");
        return false;
      }),
      inheritLoginShellEnv: vi.fn(() => {
        events.push("env-sync");
      }),
      inheritLoginShellEnvAsync: vi.fn(async () => envPromise),
      bootstrapGui: vi.fn(async () => guiPromise),
    });

    // Resolve env first, then gui — order should not matter since they
    // run in parallel, but both must be awaited before startup resolves.
    resolveEnv();
    resolveGui();

    await started;

    // CLI must fire before anything else
    expect(events[0]).toBe("cli");
    // Both async callbacks ran (sync env always runs before the parallel phase)
    expect(events).toContain("env-sync");
    expect(events).toContain("env-async-done");
    expect(events).toContain("gui-done");
    expect(events.length).toBe(4);
  });
});
