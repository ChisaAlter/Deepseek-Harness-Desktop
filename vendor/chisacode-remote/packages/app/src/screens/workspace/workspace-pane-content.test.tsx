/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import React, { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import { usePaneContext, usePaneFocus, type PaneContextValue } from "@/panels/pane-context";

vi.mock("@/panels/register-panels", () => ({
  ensurePanelsRegistered: vi.fn(),
}));

vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: () => ({
    kind: "agent",
    component: ProbePanel,
    useDescriptor: vi.fn(),
  }),
}));

interface ProbeSnapshot {
  paneContextValue: PaneContextValue;
  focus: ReturnType<typeof usePaneFocus>;
}

const snapshots: ProbeSnapshot[] = [];
const mountCount = vi.fn();
const unmountCount = vi.fn();

function ProbePanel() {
  const paneContextValue = usePaneContext();
  const focus = usePaneFocus();
  snapshots.push({ paneContextValue, focus });

  useEffect(() => {
    mountCount();
    return () => {
      unmountCount();
    };
  }, []);

  return null;
}

const agentTarget: WorkspaceTabTarget = { kind: "agent", agentId: "agent-a" };

function buildContent(target: WorkspaceTabTarget = agentTarget) {
  return buildWorkspacePaneContentModel({
    target,
    normalizedServerId: "server-a",
    normalizedWorkspaceId: "workspace-a",
    onOpenWorkspaceFile: vi.fn(),
    onOpenImportSheet: vi.fn(),
  });
}

describe("WorkspacePaneContent", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    snapshots.length = 0;
    mountCount.mockClear();
    unmountCount.mockClear();
  });

  it("updates focus without remounting panel content or replacing pane identity", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const content = buildContent();

    act(() => {
      root?.render(
        <WorkspacePaneContent content={content} isPaneFocused={false} isWorkspaceFocused={true} />,
      );
    });
    act(() => {
      root?.render(
        <WorkspacePaneContent content={content} isPaneFocused isWorkspaceFocused={true} />,
      );
    });

    expect(mountCount).toHaveBeenCalledTimes(1);
    expect(unmountCount).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.paneContextValue).toBe(snapshots[0]?.paneContextValue);
    expect(snapshots[0]?.focus).toEqual({
      isWorkspaceFocused: true,
      isPaneFocused: false,
      isInteractive: false,
      focusPane: expect.any(Function),
    });
    expect(snapshots[1]?.focus).toEqual({
      isWorkspaceFocused: true,
      isPaneFocused: true,
      isInteractive: true,
      focusPane: expect.any(Function),
    });
  });

  it("remounts panel content when the active target changes", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const draftContent = buildContent({ kind: "draft", draftId: "draft-a" });
    const agentContent = buildContent({ kind: "agent", agentId: "agent-b" });

    act(() => {
      root?.render(
        <WorkspacePaneContent content={draftContent} isPaneFocused isWorkspaceFocused={true} />,
      );
    });
    act(() => {
      root?.render(
        <WorkspacePaneContent content={agentContent} isPaneFocused isWorkspaceFocused={true} />,
      );
    });

    expect(mountCount).toHaveBeenCalledTimes(2);
    expect(unmountCount).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.paneContextValue.target).toEqual({
      kind: "agent",
      agentId: "agent-b",
    });
  });
});
