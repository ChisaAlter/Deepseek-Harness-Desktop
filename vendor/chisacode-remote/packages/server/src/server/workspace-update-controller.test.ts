import { describe, expect, test, vi } from "vitest";
import type { WorkspaceDescriptorPayload } from "./messages.js";
import { WorkspaceUpdateController } from "./workspace-update-controller.js";
import { asSessionLogger } from "./test-utils/session-stubs.js";

function createWorkspace(id: string, name = "main"): WorkspaceDescriptorPayload {
  return {
    id,
    projectId: "project-1",
    projectDisplayName: "project",
    projectCustomName: null,
    projectRootPath: "/tmp/project",
    workspaceDirectory: `/tmp/project/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name,
    archivingAt: null,
    status: "done",
    activityAt: null,
    diffStat: null,
    scripts: [],
  };
}

function createController() {
  const emitted: unknown[] = [];
  let descriptors = new Map<string, WorkspaceDescriptorPayload>();
  const controller = new WorkspaceUpdateController({
    sessionLogger: asSessionLogger({ error: vi.fn() }),
    emit: (message) => emitted.push(message),
    buildDescriptorMap: async () => descriptors,
    listWorkspaceRecords: async () => [],
    resolveWorkspaceIdForCwd: (cwd) => cwd,
    matchesFilter: () => true,
    shouldSkipGitState: () => false,
    recordGitState: vi.fn(),
    reconcileWorkspaceRecords: async () => new Set(),
  });
  return {
    controller,
    emitted,
    setDescriptors(next: Map<string, WorkspaceDescriptorPayload>) {
      descriptors = next;
    },
  };
}

describe("WorkspaceUpdateController", () => {
  test("uses the fetch snapshot as the subscription dedupe baseline", async () => {
    const { controller, emitted, setDescriptors } = createController();
    const workspace = createWorkspace("workspace-1");
    controller.startSubscription("subscription-1");
    expect(controller.completeBootstrap("subscription-1", [workspace])).toBe(true);

    setDescriptors(new Map([[workspace.id, workspace]]));
    await controller.emitUpdatesForWorkspaceIds([workspace.id], { skipReconcile: true });
    expect(emitted).toEqual([]);

    const renamed = createWorkspace(workspace.id, "feature/controller");
    setDescriptors(new Map([[workspace.id, renamed]]));
    await controller.emitUpdatesForWorkspaceIds([workspace.id], { skipReconcile: true });
    expect(emitted).toEqual([
      {
        type: "workspace_update",
        payload: { kind: "upsert", workspace: renamed },
      },
    ]);

    setDescriptors(new Map());
    await controller.emitUpdatesForWorkspaceIds([workspace.id], { skipReconcile: true });
    await controller.emitUpdatesForWorkspaceIds([workspace.id], { skipReconcile: true });
    expect(emitted.at(-1)).toEqual({
      type: "workspace_update",
      payload: { kind: "remove", id: workspace.id },
    });
    expect(emitted).toHaveLength(2);
  });

  test("flushes only bootstrap updates newer than the response snapshot", () => {
    const { controller, emitted } = createController();
    const snapshot = { ...createWorkspace("workspace-1"), activityAt: "2026-07-14T00:00:00.000Z" };
    const subscription = {
      subscriptionId: "subscription-1",
      filter: undefined,
      isBootstrapping: true,
      pendingUpdatesByWorkspaceId: new Map([
        [
          snapshot.id,
          {
            kind: "upsert" as const,
            workspace: { ...snapshot, activityAt: "2026-07-14T00:00:01.000Z" },
          },
        ],
      ]),
      lastEmittedByWorkspaceId: new Map(),
    };
    controller.setSubscription(subscription);

    expect(controller.completeBootstrap("subscription-1", [snapshot])).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(subscription.lastEmittedByWorkspaceId.get(snapshot.id)).toMatchObject({
      kind: "upsert",
      workspace: { activityAt: "2026-07-14T00:00:01.000Z" },
    });
  });
});
