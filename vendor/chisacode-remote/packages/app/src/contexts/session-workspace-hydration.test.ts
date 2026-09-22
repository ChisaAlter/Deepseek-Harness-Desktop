import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { hydrateWorkspaceDescriptors } from "./session-workspace-hydration";

const SERVER_ID = "server-1";

function workspacePayload(id: string) {
  return {
    id,
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    projectKind: "git" as const,
    workspaceKind: "worktree" as const,
    name: id,
    status: "done" as const,
    activityAt: null,
    diffStat: null,
    scripts: [],
    archivingAt: null,
  };
}

function createRecorder() {
  const workspaceWrites: Array<{
    serverId: string;
    workspaces: Map<string, WorkspaceDescriptor>;
  }> = [];
  const hydrationWrites: Array<{ serverId: string; hydrated: boolean }> = [];
  return {
    workspaceWrites,
    hydrationWrites,
    setWorkspaces: (serverId: string, workspaces: Map<string, WorkspaceDescriptor>) => {
      workspaceWrites.push({ serverId, workspaces });
    },
    setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => {
      hydrationWrites.push({ serverId, hydrated });
    },
  };
}

describe("hydrateWorkspaceDescriptors", () => {
  it("writes fetched workspaces and marks hydration complete", async () => {
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi.fn(async () => ({
        requestId: "request-1",
        entries: [workspacePayload("workspace-1")],
        pageInfo: { hasMore: false, nextCursor: null },
        subscriptionId: null,
        error: null,
      })),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

    await hydrateWorkspaceDescriptors({
      client,
      serverId: SERVER_ID,
      setWorkspaces: recorder.setWorkspaces,
      setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
    });

    expect(recorder.workspaceWrites).toHaveLength(1);
    expect(recorder.workspaceWrites[0]?.workspaces.has("workspace-1")).toBe(true);
    expect(recorder.hydrationWrites).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
  });

  it("leaves hydration incomplete after fetch failure without wiping cached workspaces", async () => {
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi.fn(async () => {
        throw new Error("Timeout waiting for message (10000ms)");
      }),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

    await expect(
      hydrateWorkspaceDescriptors({
        client,
        serverId: SERVER_ID,
        setWorkspaces: recorder.setWorkspaces,
        setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
      }),
    ).rejects.toThrow("Timeout waiting for message");

    expect(recorder.workspaceWrites).toEqual([]);
    expect(recorder.hydrationWrites).toEqual([]);
  });

  it("does not commit partial pages when a later page fails", async () => {
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({
          ...workspaceResponse("workspace-page-1", "request-page-1"),
          pageInfo: { hasMore: true, nextCursor: "next-page" },
        })
        .mockRejectedValueOnce(new Error("second page failed")),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

    await expect(
      hydrateWorkspaceDescriptors({
        client,
        serverId: SERVER_ID,
        setWorkspaces: recorder.setWorkspaces,
        setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
      }),
    ).rejects.toThrow("second page failed");

    expect(recorder.workspaceWrites).toEqual([]);
    expect(recorder.hydrationWrites).toEqual([]);
  });

  it("leaves hydration incomplete when fetch never settles", async () => {
    vi.useFakeTimers();
    try {
      const recorder = createRecorder();
      const client = {
        fetchWorkspaces: vi.fn(() => new Promise<never>(() => {})),
      } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

      const promise = hydrateWorkspaceDescriptors(
        {
          client,
          serverId: SERVER_ID,
          setWorkspaces: recorder.setWorkspaces,
          setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
        },
        { timeoutMs: 25 },
      );
      const expectation = expect(promise).rejects.toThrow(
        "Workspace hydration request timed out (25ms)",
      );

      await vi.advanceTimersByTimeAsync(25);

      await expectation;
      expect(recorder.workspaceWrites).toEqual([]);
      expect(recorder.hydrationWrites).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark hydration complete when the request is cancelled", async () => {
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi.fn(async () => ({
        requestId: "request-1",
        entries: [workspacePayload("workspace-1")],
        pageInfo: { hasMore: false, nextCursor: null },
        subscriptionId: null,
        error: null,
      })),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

    await hydrateWorkspaceDescriptors(
      {
        client,
        serverId: SERVER_ID,
        setWorkspaces: recorder.setWorkspaces,
        setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
      },
      { isCancelled: () => true },
    );

    expect(recorder.workspaceWrites).toEqual([]);
    expect(recorder.hydrationWrites).toEqual([]);
  });

  it("commits only the newest hydration generation when an older request settles late", async () => {
    let resolveOldRequest!: (value: ReturnType<typeof workspaceResponse>) => void;
    const oldRequest = new Promise<ReturnType<typeof workspaceResponse>>((resolve) => {
      resolveOldRequest = resolve;
    });
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi
        .fn()
        .mockImplementationOnce(() => oldRequest)
        .mockResolvedValueOnce(workspaceResponse("workspace-new", "request-new")),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;

    const older = hydrateWorkspaceDescriptors({
      client,
      serverId: SERVER_ID,
      setWorkspaces: recorder.setWorkspaces,
      setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
    });
    const newer = hydrateWorkspaceDescriptors({
      client,
      serverId: SERVER_ID,
      setWorkspaces: recorder.setWorkspaces,
      setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
    });

    await newer;
    resolveOldRequest(workspaceResponse("workspace-old", "request-old"));
    await older;

    expect(recorder.workspaceWrites).toHaveLength(1);
    expect(recorder.workspaceWrites[0]?.workspaces.has("workspace-new")).toBe(true);
    expect(recorder.workspaceWrites[0]?.workspaces.has("workspace-old")).toBe(false);
    expect(recorder.hydrationWrites).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
  });

  it("prevents an ABA overwrite after an intermediate generation completes", async () => {
    let resolveGenerationA!: (value: ReturnType<typeof workspaceResponse>) => void;
    let resolveGenerationC!: (value: ReturnType<typeof workspaceResponse>) => void;
    const generationA = new Promise<ReturnType<typeof workspaceResponse>>((resolve) => {
      resolveGenerationA = resolve;
    });
    const generationC = new Promise<ReturnType<typeof workspaceResponse>>((resolve) => {
      resolveGenerationC = resolve;
    });
    const recorder = createRecorder();
    const client = {
      fetchWorkspaces: vi
        .fn()
        .mockImplementationOnce(() => generationA)
        .mockResolvedValueOnce(workspaceResponse("workspace-b", "request-b"))
        .mockImplementationOnce(() => generationC),
    } as unknown as Pick<DaemonClient, "fetchWorkspaces">;
    const deps = {
      client,
      serverId: SERVER_ID,
      setWorkspaces: recorder.setWorkspaces,
      setHasHydratedWorkspaces: recorder.setHasHydratedWorkspaces,
    };

    const hydrationA = hydrateWorkspaceDescriptors(deps);
    await hydrateWorkspaceDescriptors(deps);
    const hydrationC = hydrateWorkspaceDescriptors(deps);

    resolveGenerationA(workspaceResponse("workspace-a", "request-a"));
    await hydrationA;
    expect(recorder.workspaceWrites).toHaveLength(1);
    expect(recorder.workspaceWrites[0]?.workspaces.has("workspace-b")).toBe(true);

    resolveGenerationC(workspaceResponse("workspace-c", "request-c"));
    await hydrationC;
    expect(recorder.workspaceWrites).toHaveLength(2);
    expect(recorder.workspaceWrites[1]?.workspaces.has("workspace-c")).toBe(true);
    expect(recorder.workspaceWrites.some((write) => write.workspaces.has("workspace-a"))).toBe(
      false,
    );
  });
});

function workspaceResponse(id: string, requestId: string) {
  return {
    requestId,
    entries: [workspacePayload(id)],
    pageInfo: { hasMore: false, nextCursor: null },
    subscriptionId: null,
    error: null,
  };
}
