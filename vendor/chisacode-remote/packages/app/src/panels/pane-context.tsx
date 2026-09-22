import React, { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export interface PaneContextValue {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  openFileInWorkspace: (request: WorkspaceFileOpenRequest) => void;
  openImportSheet: () => void;
}

export interface PaneFocusContextValue {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  isInteractive: boolean;
  focusPane: () => void;
}

const PaneContext = createContext<PaneContextValue | null>(null);
const PaneFocusContext = createContext<PaneFocusContextValue | null>(null);
const noopFocusPane = () => {};

export function createPaneFocusContextValue(input: {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onFocusPane?: () => void;
}): PaneFocusContextValue {
  return {
    isWorkspaceFocused: input.isWorkspaceFocused,
    isPaneFocused: input.isPaneFocused,
    isInteractive: input.isWorkspaceFocused && input.isPaneFocused,
    focusPane: input.onFocusPane ?? noopFocusPane,
  };
}

export function PaneProvider({
  value,
  children,
}: {
  value: PaneContextValue;
  children: ReactNode;
}) {
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function PaneFocusProvider({
  value,
  children,
}: {
  value: PaneFocusContextValue;
  children: ReactNode;
}) {
  return <PaneFocusContext.Provider value={value}>{children}</PaneFocusContext.Provider>;
}

export function usePaneContext(): PaneContextValue {
  const context = useContext(PaneContext);
  if (!context) {
    throw new Error("usePaneContext must be used within a PaneProvider");
  }
  return context;
}

export function usePaneFocus(): PaneFocusContextValue {
  const context = useContext(PaneFocusContext);
  if (!context) {
    throw new Error("usePaneFocus must be used within a PaneFocusProvider");
  }
  return context;
}
