import { describe, expect, test, vi } from "vitest";

import { WorkspaceMutationCoordinator } from "./workspace-mutation-coordinator.js";

describe("WorkspaceMutationCoordinator", () => {
  test("canonicalizes windows and posix paths for lock identity", () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const a = coordinator.canonicalize("C:\\tmp\\WorkTree\\branch");
    const b = coordinator.canonicalize("c:/tmp/WorkTree/branch/");
    expect(a).toBe(b);
    expect(coordinator.pathHash("C:\\tmp\\WorkTree\\branch")).toBe(
      coordinator.pathHash("c:/tmp/WorkTree/branch/"),
    );
  });

  test("serializes exclusive mutations on the same path", async () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.runExclusive("/tmp/wt", "archive-worktree", async ({ setState }) => {
      order.push("first-enter");
      setState("quiescing", "begin");
      await firstGate;
      setState("archived", "done");
      order.push("first-exit");
      return 1;
    });

    await vi.waitFor(() => {
      expect(order).toEqual(["first-enter"]);
    });

    const secondPromise = coordinator.runExclusive(
      "/tmp/wt",
      "archive-worktree",
      async ({ setState }) => {
        order.push("second-enter");
        setState("quiescing", "begin2");
        setState("archived", "done2");
        order.push("second-exit");
        return 2;
      },
    );

    // Second must not enter while first is still holding the lock.
    await Promise.resolve();
    expect(order).toEqual(["first-enter"]);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, secondPromise]);
    expect(firstResult).toBe(1);
    expect(secondResult).toBe(2);
    expect(order).toEqual(["first-enter", "first-exit", "second-enter", "second-exit"]);
  });

  test("keeps queued mutations on the same slot after an archived transition", async () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = coordinator.runExclusive(
      "/tmp/wt-queue",
      "archive-worktree",
      async ({ setState }) => {
        order.push("first-enter");
        await firstGate;
        setState("archived", "first-done");
      },
    );
    const second = coordinator.runExclusive("/tmp/wt-queue", "archive-worktree", async () => {
      order.push("second-enter");
      await secondGate;
      order.push("second-exit");
    });

    releaseFirst();
    await vi.waitFor(() => {
      expect(order).toEqual(["first-enter", "second-enter"]);
    });

    const third = coordinator.runExclusive("/tmp/wt-queue", "archive-worktree", async () => {
      order.push("third-enter");
    });
    await Promise.resolve();
    expect(order).toEqual(["first-enter", "second-enter"]);

    releaseSecond();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["first-enter", "second-enter", "second-exit", "third-enter"]);
  });

  test("restores active and rethrows when callback fails before terminal state", async () => {
    const coordinator = new WorkspaceMutationCoordinator();
    await expect(
      coordinator.runExclusive("/tmp/wt-fail", "archive-worktree", async ({ setState }) => {
        setState("quiescing", "begin");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(coordinator.getState("/tmp/wt-fail")).toBe("active");
    expect(coordinator.isAcceptingWrites("/tmp/wt-fail")).toBe(true);
  });

  test("quiescing rejects descendant writes and waits for admitted registrations", async () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const order: string[] = [];
    let releaseRegistration!: () => void;
    const registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });

    const registration = coordinator.runWithWriteLease(
      "/tmp/wt-lease/packages/app",
      "create agent",
      async () => {
        order.push("registration-enter");
        await registrationGate;
        order.push("registration-exit");
      },
    );
    await vi.waitFor(() => expect(order).toEqual(["registration-enter"]));

    const archive = coordinator.runExclusive(
      "/tmp/wt-lease",
      "archive-worktree",
      async ({ setState }) => {
        setState("quiescing", "test_quiesce");
        order.push("quiescing");
        await coordinator.waitForWritesToDrain("/tmp/wt-lease");
        order.push("drained");
        setState("active", "test_complete");
      },
    );

    await vi.waitFor(() => expect(order).toEqual(["registration-enter", "quiescing"]));
    expect(coordinator.isAcceptingWrites("/tmp/wt-lease/packages/server")).toBe(false);
    await expect(
      coordinator.runWithWriteLease("/tmp/wt-lease/packages/server", "create terminal", async () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow("Workspace is quiescing");

    releaseRegistration();
    await Promise.all([registration, archive]);
    expect(order).toEqual(["registration-enter", "quiescing", "registration-exit", "drained"]);
  });

  test("allows concurrent mutations on different paths", async () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const started: string[] = [];
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const a = coordinator.runExclusive("/tmp/a", "delete-worktree", async () => {
      started.push("a");
      await gateA;
      return "a";
    });
    const b = coordinator.runExclusive("/tmp/b", "delete-worktree", async () => {
      started.push("b");
      await gateB;
      return "b";
    });

    await vi.waitFor(() => {
      expect(started.sort()).toEqual(["a", "b"]);
    });
    releaseA();
    releaseB();
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });

  test("pathHash never includes the raw path", () => {
    const coordinator = new WorkspaceMutationCoordinator();
    const hash = coordinator.pathHash("/secret/repo/worktree");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
    expect(hash.includes("secret")).toBe(false);
  });
});
