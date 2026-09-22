import { useMemo } from "react";

import {
  buildWorkspacePaneContentModel,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

interface UseWorkspacePaneContentModelsInput {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  activeTarget: WorkspaceTabTarget | null;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet: () => void;
}

interface UseWorkspacePaneContentModelsResult {
  /** The single mounted content model for the workspace, or null for the empty state */
  contentModel: WorkspacePaneContentModel | null;
}

/** Builds the single workspace content model for the active target. */
export function useWorkspacePaneContentModels(
  input: UseWorkspacePaneContentModelsInput,
): UseWorkspacePaneContentModelsResult {
  const { normalizedServerId, normalizedWorkspaceId, activeTarget } = input;

  const contentModel = useMemo(() => {
    if (!activeTarget) {
      return null;
    }
    return buildWorkspacePaneContentModel({
      target: activeTarget,
      normalizedServerId,
      normalizedWorkspaceId,
      onOpenWorkspaceFile: input.onOpenWorkspaceFile,
      onOpenImportSheet: input.onOpenImportSheet,
    });
  }, [
    activeTarget,
    input.onOpenImportSheet,
    input.onOpenWorkspaceFile,
    normalizedServerId,
    normalizedWorkspaceId,
  ]);

  return { contentModel };
}
