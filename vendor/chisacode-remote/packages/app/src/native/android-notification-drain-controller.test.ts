import { describe, expect, it } from "vitest";

import { createAndroidNotificationDrainController } from "./android-notification-drain-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Android notification drain controller", () => {
  it("routes a durable event that arrived before listener registration exactly once", async () => {
    let pending = { serverId: "server", agentId: "agent" };
    const routed: unknown[] = [];
    const controller = createAndroidNotificationDrainController({
      drain: async () => {
        const data = pending;
        pending = null as never;
        return data;
      },
      onData: (data) => routed.push(data),
    });

    controller.requestDrain();
    await controller.whenIdle();
    controller.requestDrain();
    await controller.whenIdle();

    expect(routed).toEqual([{ serverId: "server", agentId: "agent" }]);
  });

  it("serializes simultaneous initial and event drains", async () => {
    const firstDrain = deferred<{ serverId: string; agentId: string } | null>();
    const routed: unknown[] = [];
    let calls = 0;
    const controller = createAndroidNotificationDrainController({
      drain: async () => {
        calls += 1;
        return calls === 1 ? firstDrain.promise : null;
      },
      onData: (data) => routed.push(data),
    });

    controller.requestDrain();
    controller.requestDrain();
    firstDrain.resolve({ serverId: "server", agentId: "agent" });
    await controller.whenIdle();

    expect(calls).toBe(2);
    expect(routed).toHaveLength(1);
  });

  it("does not route an in-flight result after listener cleanup", async () => {
    const drain = deferred<{ serverId: string; agentId: string } | null>();
    const routed: unknown[] = [];
    const controller = createAndroidNotificationDrainController({
      drain: () => drain.promise,
      onData: (data) => routed.push(data),
    });

    controller.requestDrain();
    controller.dispose();
    drain.resolve({ serverId: "server", agentId: "agent" });
    await controller.whenIdle();

    expect(routed).toEqual([]);
  });
});
