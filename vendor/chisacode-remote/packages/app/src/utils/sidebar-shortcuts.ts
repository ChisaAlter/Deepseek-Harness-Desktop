import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { isSidebarProjectFlattened } from "./sidebar-project-row-model";

/** Workspace identity targeted by a numbered sidebar shortcut */
export interface SidebarShortcutWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

/** Ordered shortcut targets and a workspace-key lookup of 1-based shortcut indexes */
export interface SidebarShortcutModel {
  shortcutTargets: SidebarShortcutWorkspaceTarget[];
  shortcutIndexByWorkspaceKey: Map<string, number>;
}

function createShortcutTarget(workspace: SidebarWorkspaceEntry): SidebarShortcutWorkspaceTarget {
  return {
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  };
}

/**
 * Builds keyboard shortcut targets from the visible left-sidebar workspace list
 * @param input Projects, collapsed project keys, and optional shortcut limit (default 9)
 * @returns Ordered targets and a map from workspace key to 1-based shortcut number
 */
export function buildSidebarShortcutModel(input: {
  projects: SidebarProjectEntry[];
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutLimit?: number;
}): SidebarShortcutModel {
  const maxShortcuts = Math.max(0, Math.floor(input.shortcutLimit ?? 9));
  const shortcutTargets: SidebarShortcutWorkspaceTarget[] = [];
  const shortcutIndexByWorkspaceKey = new Map<string, number>();

  for (const project of input.projects) {
    if (!isSidebarProjectFlattened(project) && input.collapsedProjectKeys.has(project.projectKey)) {
      continue;
    }

    for (const workspace of project.workspaces) {
      if (shortcutTargets.length >= maxShortcuts) {
        continue;
      }

      const shortcutNumber = shortcutTargets.length + 1;
      shortcutTargets.push(createShortcutTarget(workspace));
      shortcutIndexByWorkspaceKey.set(workspace.workspaceKey, shortcutNumber);
    }
  }

  return { shortcutTargets, shortcutIndexByWorkspaceKey };
}

/**
 * Resolves the next or previous workspace shortcut target relative to the current one
 * @param input Ordered targets, current selection, and step direction
 * @returns The adjacent target with wrap-around, or null when there are no targets
 */
export function getRelativeSidebarShortcutTarget(input: {
  targets: readonly SidebarShortcutWorkspaceTarget[];
  currentTarget: SidebarShortcutWorkspaceTarget | null;
  delta: 1 | -1;
}): SidebarShortcutWorkspaceTarget | null {
  if (input.targets.length === 0) {
    return null;
  }

  if (!input.currentTarget) {
    return input.targets[input.delta > 0 ? 0 : input.targets.length - 1] ?? null;
  }

  const currentTarget = input.currentTarget;
  const currentIndex = input.targets.findIndex(
    (target) =>
      target.serverId === currentTarget.serverId &&
      target.workspaceId === currentTarget.workspaceId,
  );
  if (currentIndex < 0) {
    return input.targets[input.delta > 0 ? 0 : input.targets.length - 1] ?? null;
  }

  const nextIndex = (currentIndex + input.delta + input.targets.length) % input.targets.length;
  return input.targets[nextIndex] ?? null;
}
