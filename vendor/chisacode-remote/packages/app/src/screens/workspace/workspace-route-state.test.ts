import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceRouteState, selectWorkspaceRouteContent } from "./workspace-route-state";

function createWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: "/repo/project",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "running",
    diffStat: null,
    scripts: [],
    archivingAt: null,
  };
}

describe("resolveWorkspaceRouteState", () => {
  it("selects ready workspace content when no route gate is active", () => {
    expect(
      selectWorkspaceRouteContent({
        gate: null,
        gatedContent: "gated",
        readyContent: "ready",
      }),
    ).toBe("ready");
  });
  it("returns unreachable when no descriptor is cached and the host is offline", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "offline",
        lastError: "transport closed",
        workspace: null,
        hasHydratedWorkspaces: false,
      }),
    ).toEqual({
      kind: "unreachable",
      hostName: "Laptop",
      connectionStatus: "offline",
      lastError: "transport closed",
    });
  });

  it("keeps offline routes unreachable after workspace hydration", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "offline",
        lastError: "transport closed",
        workspace: null,
        hasHydratedWorkspaces: true,
      }),
    ).toEqual({
      kind: "unreachable",
      hostName: "Laptop",
      connectionStatus: "offline",
      lastError: "transport closed",
    });
  });

  it("returns reconnecting when the descriptor is cached and the host is offline", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "offline",
        lastError: "transport closed",
        workspace: createWorkspaceDescriptor(),
        hasHydratedWorkspaces: true,
      }),
    ).toEqual({
      kind: "reconnecting",
      hostName: "Laptop",
      connectionStatus: "offline",
      lastError: "transport closed",
    });
  });

  it("returns missing after workspace hydration when the host is online", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "online",
        lastError: null,
        workspace: null,
        hasHydratedWorkspaces: true,
      }),
    ).toEqual({ kind: "missing", hostName: "Laptop" });
  });

  it("returns loading before workspace hydration when the host is online", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "online",
        lastError: null,
        workspace: null,
        hasHydratedWorkspaces: false,
      }),
    ).toEqual({ kind: "loading", hostName: "Laptop" });
  });

  it("returns missing when the unresolved workspace route is the host name", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "DESKTOP-TFK2NTA",
        connectionStatus: "online",
        lastError: null,
        workspace: null,
        hasHydratedWorkspaces: false,
        routeMatchesHostName: true,
      }),
    ).toEqual({ kind: "missing", hostName: "DESKTOP-TFK2NTA" });
  });

  it("returns missing when workspace route loading times out while the host is online", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "online",
        lastError: null,
        workspace: null,
        hasHydratedWorkspaces: false,
        workspaceLookupTimedOut: true,
      }),
    ).toEqual({ kind: "missing", hostName: "Laptop" });
  });

  it("returns ready when the host is online and the descriptor exists", () => {
    expect(
      resolveWorkspaceRouteState({
        hostName: "Laptop",
        connectionStatus: "online",
        lastError: null,
        workspace: createWorkspaceDescriptor(),
        hasHydratedWorkspaces: true,
      }),
    ).toEqual({ kind: "ready" });
  });
});
