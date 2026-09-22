import { describe, expect, it, vi } from "vitest";

import {
  createAndroidForegroundServiceReconciler,
  type AndroidForegroundServiceRuntime,
} from "./android-foreground-service-reconciler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRuntime(calls: string[]): AndroidForegroundServiceRuntime {
  return {
    async startForegroundService() {
      calls.push("start");
    },
    async stopForegroundService() {
      calls.push("stop");
    },
  };
}

describe("Android foreground service reconciler", () => {
  it("does not start when desired state returns false before runtime loading completes", async () => {
    const load = deferred<AndroidForegroundServiceRuntime>();
    const calls: string[] = [];
    const reconciler = createAndroidForegroundServiceReconciler({
      loadRuntime: () => load.promise,
    });

    reconciler.setDesired(true);
    reconciler.setDesired(false);
    load.resolve(createRuntime(calls));

    await reconciler.whenIdle();
    expect(calls).toEqual([]);
  });

  it("orders stop after an in-flight start when desired state becomes false", async () => {
    const start = deferred<void>();
    const calls: string[] = [];
    const runtime: AndroidForegroundServiceRuntime = {
      async startForegroundService() {
        calls.push("start");
        await start.promise;
      },
      async stopForegroundService() {
        calls.push("stop");
      },
    };
    const reconciler = createAndroidForegroundServiceReconciler({
      loadRuntime: async () => runtime,
    });

    reconciler.setDesired(true);
    await vi.waitFor(() => expect(calls).toEqual(["start"]));
    reconciler.dispose();
    start.resolve();

    await reconciler.whenIdle();
    expect(calls).toEqual(["start", "stop"]);
  });

  it("orders start after an in-flight stop when desired state becomes true", async () => {
    const stop = deferred<void>();
    const calls: string[] = [];
    const runtime: AndroidForegroundServiceRuntime = {
      async startForegroundService() {
        calls.push("start");
      },
      async stopForegroundService() {
        calls.push("stop");
        await stop.promise;
      },
    };
    const reconciler = createAndroidForegroundServiceReconciler({
      loadRuntime: async () => runtime,
    });

    reconciler.setDesired(true);
    await reconciler.whenIdle();
    reconciler.setDesired(false);
    await vi.waitFor(() => expect(calls).toEqual(["start", "stop"]));
    reconciler.setDesired(true);
    stop.resolve();

    await reconciler.whenIdle();
    expect(calls).toEqual(["start", "stop", "start"]);
  });

  it("does not duplicate operations for unchanged desired state", async () => {
    const calls: string[] = [];
    const reconciler = createAndroidForegroundServiceReconciler({
      loadRuntime: async () => createRuntime(calls),
    });

    reconciler.setDesired(true);
    reconciler.setDesired(true);
    await reconciler.whenIdle();
    reconciler.setDesired(false);
    reconciler.setDesired(false);
    await reconciler.whenIdle();

    expect(calls).toEqual(["start", "stop"]);
  });

  it("bounds rejection and retries after a later state transition", async () => {
    const errors: unknown[] = [];
    let failStart = true;
    const calls: string[] = [];
    const runtime: AndroidForegroundServiceRuntime = {
      async startForegroundService() {
        calls.push("start");
        if (failStart) {
          throw new Error("blocked");
        }
      },
      async stopForegroundService() {
        calls.push("stop");
      },
    };
    const reconciler = createAndroidForegroundServiceReconciler({
      loadRuntime: async () => runtime,
      onError: (error) => errors.push(error),
    });

    reconciler.setDesired(true);
    await reconciler.whenIdle();
    failStart = false;
    reconciler.setDesired(false);
    reconciler.setDesired(true);
    await reconciler.whenIdle();

    expect(calls).toEqual(["start", "start"]);
    expect(errors).toHaveLength(1);
  });
});
