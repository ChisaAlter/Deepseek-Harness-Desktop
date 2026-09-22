import { describe, expect, it } from "vitest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import {
  resolveSelectedSidebarAgentIdFromWorkspaceLayout,
  resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending,
} from "./selected-sidebar-agent";

describe("resolveSelectedSidebarAgentIdFromWorkspaceLayout", () => {
  it("returns the active agent id from the workspace content target", () => {
    const target: WorkspaceTabTarget = { kind: "agent", agentId: "agent-2" };

    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayout(target)).toBe("agent-2");
  });

  it("returns null when the active workspace content is not an agent", () => {
    const target: WorkspaceTabTarget = { kind: "terminal", terminalId: "term-1" };

    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayout(target)).toBeNull();
  });

  it("returns null when the workspace has no active content", () => {
    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayout(null)).toBeNull();
    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayout(undefined)).toBeNull();
  });
});

describe("resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending", () => {
  it("selects the optimistic agent of an in-flight draft create", () => {
    const target: WorkspaceTabTarget = { kind: "draft", draftId: "draft-1" };

    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, "reserved-agent-1"),
    ).toBe("reserved-agent-1");
  });

  it("returns null for a draft without an in-flight create", () => {
    const target: WorkspaceTabTarget = { kind: "draft", draftId: "draft-1" };

    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, null)).toBeNull();
    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, undefined),
    ).toBeNull();
    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, "  ")).toBeNull();
  });

  it("keeps the converted agent target behavior unchanged", () => {
    const target: WorkspaceTabTarget = { kind: "agent", agentId: "agent-2" };

    expect(resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, null)).toBe(
      "agent-2",
    );
    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, "reserved-agent-1"),
    ).toBe("agent-2");
  });

  it("returns null for non-agent non-draft targets", () => {
    const target: WorkspaceTabTarget = { kind: "terminal", terminalId: "term-1" };

    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(target, "reserved-agent-1"),
    ).toBeNull();
  });

  it("returns null when the workspace has no active content", () => {
    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(null, "reserved-1"),
    ).toBeNull();
    expect(
      resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(undefined, "reserved-1"),
    ).toBeNull();
  });
});
