import { useEffect, useRef } from "react";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";

import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  shouldAutoOpenWorkspaceSetup,
  shouldShowWorkspaceSetup,
  useWorkspaceSetupStore,
} from "@/stores/workspace-setup-store";
import { shouldSeedEmptyWorkspaceDraft } from "@/screens/workspace/workspace-empty-draft-seed";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";

interface UseWorkspacePersistenceHydrationInput {
  client: Pick<DaemonClient, "fetchWorkspaceSetupStatus"> | null;
  isRouteFocused: boolean;
  serverId: string;
  workspaceId: string;
  persistenceKey: string | null;
  workspaceDirectory: string | null;
  hasHydratedWorkspaceLayoutStore: boolean;
  hasHydratedAgents: boolean;
  terminalsHydrated: boolean;
  terminalCount: number;
  activeAgentCount: number;
  hasActiveTarget: boolean;
  openWorkspaceDraftTab: () => void;
}

interface UseWorkspacePersistenceHydrationResult {
  showWorkspaceSetup: boolean;
}

/** Owns workspace setup hydration, automatic setup recovery, and empty-workspace draft seeding. */
export function useWorkspacePersistenceHydration(
  input: UseWorkspacePersistenceHydrationInput,
): UseWorkspacePersistenceHydrationResult {
  const openWorkspaceDraftTab = input.openWorkspaceDraftTab;
  const openWorkspaceTarget = useWorkspaceLayoutStore((state) => state.openTarget);
  const workspaceSetupSnapshot = useWorkspaceSetupStore((state) =>
    input.persistenceKey ? (state.snapshots[input.persistenceKey] ?? null) : null,
  );
  const upsertWorkspaceSetupProgress = useWorkspaceSetupStore((state) => state.upsertProgress);
  const showWorkspaceSetup = shouldShowWorkspaceSetup(workspaceSetupSnapshot);
  const emptyWorkspaceSeedKeysRef = useRef<Set<string>>(new Set());
  const autoOpenedSetupWorkspaceRef = useRef<string | null>(null);
  const requestedWorkspaceSetupStatusKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !input.isRouteFocused ||
      !input.client ||
      !input.serverId ||
      !input.workspaceId ||
      !input.persistenceKey ||
      workspaceSetupSnapshot ||
      requestedWorkspaceSetupStatusKeyRef.current === input.persistenceKey
    ) {
      return;
    }

    requestedWorkspaceSetupStatusKeyRef.current = input.persistenceKey;
    let isCancelled = false;

    input.client
      .fetchWorkspaceSetupStatus(input.workspaceId)
      .then((response) => {
        if (isCancelled || response.workspaceId !== input.workspaceId || !response.snapshot) {
          return;
        }
        upsertWorkspaceSetupProgress({
          serverId: input.serverId,
          payload: { workspaceId: response.workspaceId, ...response.snapshot },
          source: "cached",
        });
        return;
      })
      .catch(() => {
        if (requestedWorkspaceSetupStatusKeyRef.current === input.persistenceKey) {
          requestedWorkspaceSetupStatusKeyRef.current = null;
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    input.client,
    input.isRouteFocused,
    input.persistenceKey,
    input.serverId,
    input.workspaceId,
    upsertWorkspaceSetupProgress,
    workspaceSetupSnapshot,
  ]);

  useEffect(() => {
    const hasSeedPrerequisites = Boolean(
      input.isRouteFocused &&
      input.persistenceKey &&
      input.workspaceDirectory &&
      input.hasHydratedWorkspaceLayoutStore &&
      input.hasHydratedAgents &&
      input.terminalsHydrated,
    );
    if (!hasSeedPrerequisites || !input.persistenceKey) {
      return;
    }

    const hasConsideredEmptyWorkspaceDraftSeed = emptyWorkspaceSeedKeysRef.current.has(
      input.persistenceKey,
    );
    const shouldSeedDraft = shouldSeedEmptyWorkspaceDraft({
      isRouteFocused: input.isRouteFocused,
      hasPersistenceKey: true,
      hasWorkspaceDirectory: true,
      hasHydratedWorkspaceLayoutStore: input.hasHydratedWorkspaceLayoutStore,
      hasHydratedAgents: input.hasHydratedAgents,
      hasLoadedTerminals: input.terminalsHydrated,
      hasConsideredEmptyWorkspaceDraftSeed,
      activeAgentCount: input.activeAgentCount,
      terminalCount: input.terminalCount,
      hasActiveTarget: input.hasActiveTarget,
    });

    if (hasConsideredEmptyWorkspaceDraftSeed) {
      return;
    }
    emptyWorkspaceSeedKeysRef.current.add(input.persistenceKey);
    if (shouldSeedDraft) {
      openWorkspaceDraftTab();
    }
  }, [
    input.activeAgentCount,
    input.hasActiveTarget,
    input.hasHydratedAgents,
    input.hasHydratedWorkspaceLayoutStore,
    input.isRouteFocused,
    openWorkspaceDraftTab,
    input.persistenceKey,
    input.terminalCount,
    input.terminalsHydrated,
    input.workspaceDirectory,
  ]);

  useEffect(() => {
    if (!input.isRouteFocused || !input.persistenceKey) {
      return;
    }
    if (!workspaceSetupSnapshot || !showWorkspaceSetup) {
      if (autoOpenedSetupWorkspaceRef.current === input.persistenceKey) {
        autoOpenedSetupWorkspaceRef.current = null;
      }
      return;
    }
    if (!shouldAutoOpenWorkspaceSetup(workspaceSetupSnapshot)) {
      return;
    }
    if (input.hasActiveTarget) {
      autoOpenedSetupWorkspaceRef.current = input.persistenceKey;
      return;
    }
    if (autoOpenedSetupWorkspaceRef.current === input.persistenceKey) {
      return;
    }

    const target = normalizeWorkspaceTabTarget({
      kind: "setup",
      workspaceId: input.workspaceId,
    });
    if (!target) {
      return;
    }
    openWorkspaceTarget(input.persistenceKey, target);
    autoOpenedSetupWorkspaceRef.current = input.persistenceKey;
  }, [
    input.hasActiveTarget,
    input.isRouteFocused,
    input.persistenceKey,
    input.workspaceId,
    openWorkspaceTarget,
    showWorkspaceSetup,
    workspaceSetupSnapshot,
  ]);

  return { showWorkspaceSetup };
}
