import React, { useMemo, type ComponentType } from "react";
import invariant from "tiny-invariant";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { getPanelRegistration } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export interface WorkspacePaneContentModel {
  key: string;
  /** Active target kind — lets the center column host decide layout shells
   *  (e.g. the centered conversation column) without re-deriving the target. */
  kind: WorkspaceTabTarget["kind"];
  Component: ComponentType;
  paneContextValue: PaneContextValue;
}

export interface BuildWorkspacePaneContentModelInput {
  target: WorkspaceTabTarget;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet: () => void;
}

export function buildWorkspacePaneContentModel({
  target,
  normalizedServerId,
  normalizedWorkspaceId,
  onOpenWorkspaceFile,
  onOpenImportSheet,
}: BuildWorkspacePaneContentModelInput): WorkspacePaneContentModel {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(target.kind);
  invariant(registration, `No panel registration for kind: ${target.kind}`);
  return {
    key: `${normalizedServerId}:${normalizedWorkspaceId}:${target.kind}:${describeTargetId(target)}`,
    kind: target.kind,
    Component: registration.component,
    paneContextValue: {
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      target,
      openFileInWorkspace: onOpenWorkspaceFile,
      openImportSheet: onOpenImportSheet,
    },
  };
}

function describeTargetId(target: WorkspaceTabTarget): string {
  switch (target.kind) {
    case "draft":
      return target.draftId;
    case "agent":
      return target.agentId;
    case "terminal":
      return target.terminalId;
    case "browser":
      return target.browserId;
    case "file":
      return target.path;
    case "setup":
      return target.workspaceId;
  }
}

export interface WorkspacePaneContentProps {
  content: WorkspacePaneContentModel;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onFocusPane?: () => void;
}

export function WorkspacePaneContent({
  content,
  isWorkspaceFocused,
  isPaneFocused,
  onFocusPane,
}: WorkspacePaneContentProps) {
  const { Component, key, paneContextValue } = content;
  const paneFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused,
        isPaneFocused,
        onFocusPane,
      }),
    [isPaneFocused, isWorkspaceFocused, onFocusPane],
  );

  return (
    <PaneProvider value={paneContextValue}>
      <PaneFocusProvider value={paneFocusValue}>
        <Component key={key} />
      </PaneFocusProvider>
    </PaneProvider>
  );
}
