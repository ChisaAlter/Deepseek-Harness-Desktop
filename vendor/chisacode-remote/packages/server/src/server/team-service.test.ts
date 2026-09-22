import { describe, expect, test } from "vitest";

import {
  cancelQueuedMessage,
  consumeMessage,
  createTeam,
  createWorker,
  endTeam,
  listQueuedMessages,
  queueMessage,
  setFocusedWorker,
  setWorkerStatus,
  TeamError,
  updateQueuedMessage,
  type WorkerState,
} from "./team-service.js";

const NOW = 1000000;

function makeWorker(overrides?: Partial<WorkerState>): WorkerState {
  return {
    id: "w1",
    teamId: "t1",
    sessionId: "s1",
    role: "developer",
    label: "worker-1",
    status: "idle",
    focused: false,
    idleSince: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe("createTeam / endTeam", () => {
  test("creates active team", () => {
    const team = createTeam("t1", "lead-session", NOW);
    expect(team.status).toBe("active");
    expect(team.leadSessionId).toBe("lead-session");
  });

  test("ends team with status", () => {
    const team = createTeam("t1", "lead", NOW);
    const ended = endTeam(team, "completed", NOW + 100);
    expect(ended.status).toBe("completed");
  });
});

describe("createWorker", () => {
  test("creates first worker as focused", () => {
    const { worker, softLimitExceeded } = createWorker(
      { id: "w1", teamId: "t1", sessionId: "s1", label: "dev-1" },
      [],
      undefined,
      NOW,
    );
    expect(worker.focused).toBe(true);
    expect(worker.role).toBe("developer");
    expect(softLimitExceeded).toBe(false);
  });

  test("rejects duplicate labels (case-insensitive)", () => {
    const existing = [makeWorker({ label: "Dev-1" })];
    expect(() =>
      createWorker({ id: "w2", teamId: "t1", sessionId: "s2", label: "dev-1" }, existing),
    ).toThrow(TeamError);
  });

  test("allows duplicate label if original is archived", () => {
    const existing = [makeWorker({ label: "dev-1", status: "archived" })];
    const { worker } = createWorker(
      { id: "w2", teamId: "t1", sessionId: "s2", label: "dev-1" },
      existing,
      undefined,
      NOW,
    );
    expect(worker.label).toBe("dev-1");
  });

  test("enforces hard limit", () => {
    const existing = Array.from({ length: 10 }, (_, i) =>
      makeWorker({ id: `w${i}`, label: `w-${i}` }),
    );
    expect(() =>
      createWorker({ id: "w99", teamId: "t1", sessionId: "s99", label: "overflow" }, existing),
    ).toThrow("Worker limit reached");
  });

  test("warns on soft limit", () => {
    const existing = Array.from({ length: 5 }, (_, i) =>
      makeWorker({ id: `w${i}`, label: `w-${i}` }),
    );
    const { softLimitExceeded } = createWorker(
      { id: "w5", teamId: "t1", sessionId: "s5", label: "w-5" },
      existing,
    );
    expect(softLimitExceeded).toBe(true);
  });
});

describe("setWorkerStatus", () => {
  test("sets idle with timestamp", () => {
    const w = setWorkerStatus(makeWorker({ status: "running" }), "idle", NOW + 100);
    expect(w.status).toBe("idle");
    expect(w.idleSince).toBe(NOW + 100);
  });

  test("clears focus on archive", () => {
    const w = setWorkerStatus(makeWorker({ focused: true }), "archived", NOW);
    expect(w.focused).toBe(false);
  });
});

describe("setFocusedWorker", () => {
  test("focuses one worker, unfocuses others", () => {
    const workers = [
      makeWorker({ id: "w1", focused: true }),
      makeWorker({ id: "w2" }),
      makeWorker({ id: "w3" }),
    ];
    const result = setFocusedWorker(workers, "w2");
    expect(result.find((w) => w.id === "w1")?.focused).toBe(false);
    expect(result.find((w) => w.id === "w2")?.focused).toBe(true);
  });
});

describe("message queue", () => {
  test("queue and list messages", () => {
    const q = [
      queueMessage("m1", "w1", "task A", NOW),
      queueMessage("m2", "w1", "task B", NOW + 1),
      queueMessage("m3", "w2", "task C", NOW + 2),
    ];
    expect(listQueuedMessages(q, "w1")).toHaveLength(2);
    expect(listQueuedMessages(q, "w2")).toHaveLength(1);
  });

  test("update queued message", () => {
    const q = [queueMessage("m1", "w1", "original", NOW)];
    const updated = updateQueuedMessage(q, "m1", "revised");
    expect(updated[0].content).toBe("revised");
  });

  test("rejects update of consumed message", () => {
    let q = [queueMessage("m1", "w1", "original", NOW)];
    q = consumeMessage(q, "m1");
    expect(() => updateQueuedMessage(q, "m1", "nope")).toThrow("consumed");
  });

  test("cancel removes message", () => {
    const q = [queueMessage("m1", "w1", "task", NOW)];
    const result = cancelQueuedMessage(q, "m1");
    expect(result).toHaveLength(0);
  });

  test("cancel throws for missing message", () => {
    expect(() => cancelQueuedMessage([], "missing")).toThrow("not found");
  });

  test("consume marks message as consumed", () => {
    let q = [queueMessage("m1", "w1", "task", NOW)];
    q = consumeMessage(q, "m1");
    expect(q[0].consumed).toBe(true);
    expect(listQueuedMessages(q, "w1")).toHaveLength(0);
  });
});
