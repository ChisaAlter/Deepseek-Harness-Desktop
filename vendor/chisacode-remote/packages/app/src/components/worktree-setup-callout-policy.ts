import type { ChisaCodeConfigRaw } from "@chisacode/protocol/messages";
import { buildProjectSettingsRoute } from "@/utils/host-routes";

export interface WorktreeSetupWorkspaceInput {
  projectId: string;
  projectKind: string;
  projectRootPath: string;
  project?: {
    checkout?: {
      mainRepoRoot?: string | null;
    } | null;
  } | null;
}

export interface ActiveGitWorkspaceProject {
  serverId: string;
  projectKey: string;
  repoRoot: string;
}

interface ReadProjectConfigResult {
  ok: boolean;
  config?: ChisaCodeConfigRaw | null;
}

export interface WorktreeSetupCalloutPolicy {
  id: string;
  dismissalKey: string;
  priority: number;
  title: string;
  description: string;
  actionLabel: string;
  projectSettingsRoute: `/settings/projects/${string}`;
  testID: string;
}

export function selectActiveGitWorkspaceProject(
  serverId: string,
  workspace: WorktreeSetupWorkspaceInput,
): ActiveGitWorkspaceProject | null {
  if (workspace.projectKind !== "git") {
    return null;
  }

  const projectKey = workspace.projectId.trim();
  const repoRoot = (workspace.project?.checkout?.mainRepoRoot ?? workspace.projectRootPath).trim();
  if (!projectKey || !repoRoot) {
    return null;
  }

  return { serverId, projectKey, repoRoot };
}

export function shouldShowWorktreeSetupCallout(readResult: ReadProjectConfigResult | undefined) {
  return readResult?.ok === true && !hasSetupCommands(readResult.config ?? {});
}

export function buildWorktreeSetupCalloutPolicy(
  project: ActiveGitWorkspaceProject,
): WorktreeSetupCalloutPolicy {
  const calloutKey = `worktree-setup-missing:${project.projectKey}`;

  return {
    id: calloutKey,
    dismissalKey: calloutKey,
    priority: 100,
    title: "设置 worktree 脚本",
    description: "添加 setup 命令，让新 worktree 自动安装依赖并完成准备工作。",
    actionLabel: "打开项目设置",
    projectSettingsRoute: buildProjectSettingsRoute(project.projectKey),
    testID: `worktree-setup-callout-${project.projectKey}`,
  };
}

function hasSetupCommands(config: ChisaCodeConfigRaw): boolean {
  const setup = config.worktree?.setup;
  if (typeof setup === "string") {
    return setup.trim().length > 0;
  }
  if (Array.isArray(setup)) {
    return setup.some((command) => typeof command === "string" && command.trim().length > 0);
  }
  return false;
}
