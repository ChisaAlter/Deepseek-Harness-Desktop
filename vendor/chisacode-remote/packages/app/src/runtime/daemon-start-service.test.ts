import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonStartService } from "./daemon-start-service";
import type { HostRuntimeStore } from "./host-runtime";
import type { DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";

interface RecordedUpsert {
  listenAddress: string;
  serverId: string;
  hostname: string | null;
}

/**
 * Fake store that implements the three surfaces the DaemonStartService needs:
 * upsertConnectionFromListen (returns a fake profile), subscribeAll (notifies
 * listeners), and getSnapshot (returns a controllable connectionStatus).
 */
function createFakeStore(): {
  store: Pick<HostRuntimeStore, "upsertConnectionFromListen" | "subscribeAll" | "getSnapshot">;
  upserts: RecordedUpsert[];
  setConnectionStatus: (serverId: string, status: string) => void;
  notifyStoreChange: () => void;
} {
  const upserts: RecordedUpsert[] = [];
  const listeners = new Set<() => void>();
  const statuses = new Map<string, string>();
  return {
    store: {
      upsertConnectionFromListen: async (input: RecordedUpsert) => {
        upserts.push(input);
        statuses.set(input.serverId, "connecting");
        return { serverId: input.serverId } as Awaited<
          ReturnType<HostRuntimeStore["upsertConnectionFromListen"]>
        >;
      },
      subscribeAll: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: (serverId: string) => {
        const status = statuses.get(serverId) ?? "connecting";
        return { connectionStatus: status } as Awaited<ReturnType<HostRuntimeStore["getSnapshot"]>>;
      },
    },
    upserts,
    setConnectionStatus: (serverId: string, status: string) => {
      statuses.set(serverId, status);
    },
    notifyStoreChange: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function makeStatus(overrides: Partial<DesktopDaemonStatus> = {}): DesktopDaemonStatus {
  return {
    serverId: "srv_desktop",
    status: "running",
    listen: "127.0.0.1:6767",
    hostname: "desktop",
    pid: 1234,
    home: "/home",
    version: "0.0.0",
    desktopManaged: true,
    error: null,
    ...overrides,
  };
}

describe("DaemonStartService", () => {
  it("upserts the connection on a successful daemon start", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
    });

    const result = await service.start();

    expect(result).toEqual({ ok: true });
    expect(fake.upserts).toEqual([
      { listenAddress: "127.0.0.1:6767", serverId: "srv_desktop", hostname: "desktop" },
    ]);
    expect(service.getLastError()).toBeNull();
    expect(service.isRunning()).toBe(false);
  });

  it("reports lastError after a missing listen address and clears running state when done", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus({ listen: null }),
    });

    const result = await service.start();

    expect(result).toEqual({
      ok: false,
      error: "Desktop daemon did not return a listen address.",
    });
    expect(service.getLastError()).toBe("Desktop daemon did not return a listen address.");
    expect(service.isRunning()).toBe(false);
    expect(fake.upserts).toEqual([]);
  });

  it("reports lastError when the daemon does not return a server id", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus({ serverId: "" }),
    });

    const result = await service.start();

    expect(result).toEqual({ ok: false, error: "Desktop daemon did not return a server id." });
    expect(service.getLastError()).toBe("Desktop daemon did not return a server id.");
    expect(fake.upserts).toEqual([]);
  });

  it("reports lastError when the listen address is unsupported", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus({ listen: "???" }),
    });

    const result = await service.start();

    expect(result.ok).toBe(false);
    expect(service.getLastError()).toContain("unsupported listen address");
    expect(fake.upserts).toEqual([]);
  });

  it("reports lastError when the underlying start call throws", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => {
        throw new Error("ipc broke");
      },
    });

    const result = await service.start();

    expect(result).toEqual({ ok: false, error: "ipc broke" });
    expect(service.getLastError()).toBe("ipc broke");
  });

  it("clears lastError on retry entry and reports null after subsequent success", async () => {
    const fake = createFakeStore();
    const startMock = vi
      .fn<() => Promise<DesktopDaemonStatus>>()
      .mockRejectedValueOnce(new Error("ipc broke"))
      .mockResolvedValueOnce(makeStatus());
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: () => startMock(),
    });

    const failure = await service.start();
    expect(failure.ok).toBe(false);
    expect(service.getLastError()).toBe("ipc broke");

    const success = await service.start();
    expect(success).toEqual({ ok: true });
    expect(service.getLastError()).toBeNull();
  });

  it("notifies subscribers when isRunning toggles between calls", async () => {
    const fake = createFakeStore();
    let resolveStart: ((value: DesktopDaemonStatus) => void) | undefined;
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: () =>
        new Promise<DesktopDaemonStatus>((resolve) => {
          resolveStart = resolve;
        }),
    });

    const runningSnapshots: boolean[] = [];
    service.subscribe(() => {
      runningSnapshots.push(service.isRunning());
    });

    const startPromise = service.start();
    expect(service.isRunning()).toBe(true);
    expect(runningSnapshots).toEqual([true]);

    resolveStart?.(makeStatus());
    await startPromise;

    expect(service.isRunning()).toBe(false);
    expect(runningSnapshots).toEqual([true, false]);
  });

  it("clears the error and notifies subscribers when retry begins", async () => {
    const fake = createFakeStore();
    const startMock = vi
      .fn<() => Promise<DesktopDaemonStatus>>()
      .mockRejectedValueOnce(new Error("ipc broke"))
      .mockResolvedValueOnce(makeStatus());
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: () => startMock(),
    });

    await service.start();
    expect(service.getLastError()).toBe("ipc broke");

    const errorSnapshots: Array<string | null> = [];
    service.subscribe(() => {
      errorSnapshots.push(service.getLastError());
    });

    await service.start();
    expect(errorSnapshots[0]).toBeNull();
    expect(service.getLastError()).toBeNull();
  });

  it("recordError surfaces an external error and notifies subscribers", () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
    });
    const notifications = vi.fn();
    service.subscribe(notifications);

    service.recordError("settings file unreadable");

    expect(service.getLastError()).toBe("settings file unreadable");
    expect(notifications).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after a subscriber unsubscribes", async () => {
    const fake = createFakeStore();
    let notifications = 0;
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus({ listen: null }),
    });
    const unsubscribe = service.subscribe(() => {
      notifications += 1;
    });

    await service.start();
    const countAfterFirst = notifications;
    expect(countAfterFirst).toBeGreaterThan(0);

    unsubscribe();
    await service.start();
    expect(notifications).toBe(countAfterFirst);
  });
});

describe("DaemonStartService connecting watch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a timeout error when the connection does not reach online within the timeout", async () => {
    vi.useFakeTimers();
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
      connectingTimeoutMs: 5_000,
    });

    const result = await service.start();
    expect(result).toEqual({ ok: true });
    expect(service.getLastError()).toBeNull();

    vi.advanceTimersByTime(5_000);

    expect(service.getLastError()).toBe(
      "Desktop daemon started but the connection was not established. Please retry.",
    );
    expect(service.hasSettledWithError()).toBe(true);
  });

  it("clears the timeout when the connection reaches online before the deadline", async () => {
    vi.useFakeTimers();
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
      connectingTimeoutMs: 5_000,
    });

    await service.start();
    expect(service.getLastError()).toBeNull();

    fake.setConnectionStatus("srv_desktop", "online");
    fake.notifyStoreChange();
    vi.advanceTimersByTime(10_000);

    expect(service.getLastError()).toBeNull();
    expect(service.hasSettledWithError()).toBe(false);
  });

  it("does not arm a connecting watch when start fails", async () => {
    vi.useFakeTimers();
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => {
        throw new Error("ipc broke");
      },
      connectingTimeoutMs: 5_000,
    });

    await service.start();
    vi.advanceTimersByTime(10_000);

    expect(service.getLastError()).toBe("ipc broke");
  });
});

describe("DaemonStartService restart", () => {
  it("calls restartDesktopDaemon instead of startDesktopDaemon", async () => {
    const fake = createFakeStore();
    const restartMock = vi.fn(async () => makeStatus());
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: vi.fn(async () => makeStatus()),
      restartDesktopDaemon: restartMock,
    });

    await service.restart();

    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(fake.upserts).toHaveLength(1);
    expect(service.hasEverSucceededCheck()).toBe(true);
  });

  it("reports an error when restart throws", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      restartDesktopDaemon: async () => {
        throw new Error("restart failed");
      },
    });

    const result = await service.restart();
    expect(result.ok).toBe(false);
    expect(service.getLastError()).toBe("restart failed");
  });
});

describe("DaemonStartService hasEverSucceeded", () => {
  it("returns false before any successful start", () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
    });

    expect(service.hasEverSucceededCheck()).toBe(false);
  });

  it("returns true after a successful start", async () => {
    const fake = createFakeStore();
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: async () => makeStatus(),
    });

    await service.start();

    expect(service.hasEverSucceededCheck()).toBe(true);
  });

  it("returns true after a successful restart even when a prior start failed", async () => {
    const fake = createFakeStore();
    const startMock = vi
      .fn<() => Promise<DesktopDaemonStatus>>()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce(makeStatus());
    const service = new DaemonStartService({
      store: fake.store,
      startDesktopDaemon: () => startMock(),
    });

    await service.start();
    expect(service.hasEverSucceededCheck()).toBe(false);

    await service.start();
    expect(service.hasEverSucceededCheck()).toBe(true);
  });
});
