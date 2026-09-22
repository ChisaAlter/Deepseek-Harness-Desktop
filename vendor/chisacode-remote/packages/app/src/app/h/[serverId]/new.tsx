import { useLocalSearchParams } from "expo-router";
import { NewWorkspaceScreen } from "@/screens/new-workspace-screen";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useLastDraftDirectory } from "@/stores/last-draft-directory-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { resolveNewWorkspaceDefaultDirectory } from "@/screens/new-workspace-default-directory";

export default function HostNewWorkspaceRoute() {
  const params = useLocalSearchParams<{
    serverId?: string;
    dir?: string;
    name?: string;
    projectId?: string;
    draft?: string;
  }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const routeDirectory = typeof params.dir === "string" ? params.dir : null;
  const displayName = typeof params.name === "string" ? params.name : undefined;
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const resetKey = typeof params.draft === "string" ? params.draft : undefined;
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const lastDraftDirectory = useLastDraftDirectory(serverId);
  const activeWorkspace = useWorkspace(
    serverId,
    lastWorkspaceSelection?.serverId === serverId ? lastWorkspaceSelection.workspaceId : null,
  );
  const sourceDirectory = resolveNewWorkspaceDefaultDirectory({
    routeDirectory,
    lastDraftDirectory,
    activeWorkspace,
  });

  return (
    <NewWorkspaceScreen
      serverId={serverId}
      sourceDirectory={sourceDirectory}
      displayName={displayName}
      projectId={projectId}
      resetKey={resetKey}
    />
  );
}
