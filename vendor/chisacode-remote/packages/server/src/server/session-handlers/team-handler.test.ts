import { describe, expect, test, vi } from "vitest";

import { TeamHandler, TeamManager } from "./team-handler.js";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: "team/create-worker",
    requestId: "r1",
    label: "worker-1",
    role: "developer",
    ...overrides,
  } as never;
}

function makeHandler(
  opts: {
    spawnWorker?: (options: never) => Promise<string>;
    terminateWorker?: (agentId: string) => Promise<void>;
  } = {},
) {
  const emitted: unknown[] = [];
  const teamManager = new TeamManager();
  // Start a team so worker creation is allowed.
  teamManager.startTeam("lead-session", 1000);
  const handler = new TeamHandler({
    sessionLogger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    teamManager,
    sessionId: "lead-session",
    emit: (message) => emitted.push(message),
    ...(opts.spawnWorker ? { spawnWorker: opts.spawnWorker } : {}),
    ...(opts.terminateWorker ? { terminateWorker: opts.terminateWorker } : {}),
  });
  return { handler, teamManager, emitted };
}

describe("TeamHandler handleTeamCreateWorkerRequest", () => {
  test("returns error and does not add a worker when spawn fails", async () => {
    const spawnWorker = vi.fn().mockRejectedValue(new Error("rate limited"));
    const { handler, teamManager, emitted } = makeHandler({ spawnWorker });

    await handler.handleTeamCreateWorkerRequest(makeRequest());

    // The response must surface the spawn failure, not a fake success.
    const response = emitted.find(
      (m) => (m as { type?: string }).type === "team/create-worker/response",
    ) as { payload: { error: string | null; worker: unknown } };
    expect(response.payload.error).toMatch(/rate limited/);
    expect(response.payload.worker).toBeNull();
    // No orphan worker record should be created.
    expect(teamManager.getWorkers()).toHaveLength(0);
  });

  test("adds a worker with the spawned agent id on success", async () => {
    const spawnWorker = vi.fn().mockResolvedValue("agent-123");
    const { handler, teamManager, emitted } = makeHandler({ spawnWorker });

    await handler.handleTeamCreateWorkerRequest(makeRequest());

    const response = emitted.find(
      (m) => (m as { type?: string }).type === "team/create-worker/response",
    ) as { payload: { error: string | null; worker: { sessionId: string } | null } };
    expect(response.payload.error).toBeNull();
    expect(response.payload.worker?.sessionId).toBe("agent-123");
    expect(teamManager.getWorkers()).toHaveLength(1);
  });
});

describe("TeamHandler worker termination", () => {
  test("terminates the worker agent when archived", async () => {
    const terminateWorker = vi.fn().mockResolvedValue(undefined);
    const spawnWorker = vi.fn().mockResolvedValue("agent-arch");
    const { handler, teamManager } = makeHandler({ spawnWorker, terminateWorker });

    await handler.handleTeamCreateWorkerRequest(makeRequest());
    const worker = teamManager.getWorkers()[0];
    expect(worker).toBeDefined();

    await handler.handleTeamArchiveWorkerRequest({
      type: "team/archive-worker",
      requestId: "r2",
      workerId: worker.id,
    } as never);

    expect(terminateWorker).toHaveBeenCalledWith("agent-arch");
  });

  test("terminates all worker agents when the team ends", async () => {
    const terminateWorker = vi.fn().mockResolvedValue(undefined);
    const spawnWorker = vi.fn().mockResolvedValueOnce("agent-a").mockResolvedValueOnce("agent-b");
    const { handler } = makeHandler({ spawnWorker, terminateWorker });

    await handler.handleTeamCreateWorkerRequest(makeRequest({ label: "w-a" }));
    await handler.handleTeamCreateWorkerRequest(makeRequest({ label: "w-b" }));

    await handler.handleTeamEndRequest({
      type: "team/end",
      requestId: "r3",
    } as never);

    expect(terminateWorker).toHaveBeenCalledWith("agent-a");
    expect(terminateWorker).toHaveBeenCalledWith("agent-b");
  });
});
