import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { router, usePathname, type Href } from "expo-router";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { useAllAgentsList } from "@/hooks/use-all-agents-list";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import {
  clearCommandCenterFocusRestoreElement,
  takeCommandCenterFocusRestoreElement,
} from "@/utils/command-center-focus-restore";
import { buildHostOpenProjectRoute, buildSettingsRoute } from "@/utils/host-routes";
import {
  buildHostSessionsRoute,
  buildHostWorkspaceOpenRoute,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { chordStringToShortcutKeys } from "@/keyboard/shortcut-string";
import { getBindingIdForAction, getDefaultKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { focusWithRetries } from "@/utils/web-focus";
import { useActiveServerId } from "@/hooks/use-active-server-id";
import { useTranslation } from "react-i18next";
import {
  buildCommandCenterActionItems,
  type CommandCenterActionItem,
} from "@/hooks/command-center-actions";
import {
  compareCommandCenterAgents,
  matchesCommandCenterAgent,
  resolveCommandCenterAgentTarget,
} from "@/hooks/command-center-agents";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { isWeb } from "@/constants/platform";

const EMPTY_AGENTS: AggregatedAgent[] = [];
const EMPTY_COMMAND_CENTER_ITEMS: CommandCenterItem[] = [];

export type CommandCenterItem =
  | {
      kind: "action";
      action: CommandCenterActionItem;
    }
  | {
      kind: "agent";
      agent: AggregatedAgent;
    };

function resolveActionShortcutKeys(
  actionId: string | undefined,
  overrides: Record<string, string>,
): ShortcutKey[][] | undefined {
  if (!actionId) return undefined;
  const isMac = getShortcutOs() === "mac";
  const isDesktopApp = getIsElectronRuntime();
  const platform = { isMac, isDesktop: isDesktopApp };
  const bindingId = getBindingIdForAction(actionId, platform);
  if (!bindingId) return undefined;
  const override = overrides[bindingId];
  if (override) return chordStringToShortcutKeys(override);
  const defaultKeys = getDefaultKeysForAction(actionId, platform);
  return defaultKeys ? [defaultKeys] : undefined;
}

export function useCommandCenter() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const routeActiveServerId = useActiveServerId();
  const { overrides } = useKeyboardShortcutOverrides();
  const open = useKeyboardShortcutsStore((s) => s.commandCenterOpen);
  const inputRef = useRef<TextInput>(null);
  const didNavigateRef = useRef(false);
  const prevOpenRef = useRef(open);
  const activeIndexRef = useRef(0);
  const itemsRef = useRef<CommandCenterItem[]>([]);
  const handleCloseRef = useRef<() => void>(() => undefined);
  const handleSelectItemRef = useRef<(item: CommandCenterItem) => void>(() => undefined);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const activeServerId = open ? routeActiveServerId : null;
  const currentWorkspaceRoute = useMemo(
    () => (open ? parseHostWorkspaceRouteFromPathname(pathname) : null),
    [open, pathname],
  );

  const { agents } = useAllAgentsList({
    serverId: activeServerId,
  });

  const agentResults = useMemo(() => {
    if (!open || agents.length === 0) {
      return EMPTY_AGENTS;
    }
    const filtered = agents.filter((agent) => matchesCommandCenterAgent(agent, query));
    filtered.sort(compareCommandCenterAgents);
    return filtered;
  }, [agents, open, query]);

  const settingsRoute = useMemo<Href>(() => {
    return buildSettingsRoute({ returnTo: pathname }) as Href;
  }, [pathname]);

  const homeRoute = useMemo<Href | undefined>(() => {
    if (!routeActiveServerId) return undefined;
    return buildHostOpenProjectRoute(routeActiveServerId) as Href;
  }, [routeActiveServerId]);

  const sessionsRoute = useMemo<Href | undefined>(() => {
    if (!routeActiveServerId) return undefined;
    return buildHostSessionsRoute(routeActiveServerId) as Href;
  }, [routeActiveServerId]);

  const currentWorkspaceDraftRoute = useMemo<Href | undefined>(() => {
    if (!currentWorkspaceRoute) return undefined;
    return buildHostWorkspaceOpenRoute(
      currentWorkspaceRoute.serverId,
      currentWorkspaceRoute.workspaceId,
      "draft:new",
    ) as Href;
  }, [currentWorkspaceRoute]);
  const currentWorkspaceKind = useWorkspaceFields(
    currentWorkspaceRoute?.serverId ?? null,
    currentWorkspaceRoute?.workspaceId ?? null,
    (workspace) => workspace.workspaceKind,
  );
  const currentProjectKind = useWorkspaceFields(
    currentWorkspaceRoute?.serverId ?? null,
    currentWorkspaceRoute?.workspaceId ?? null,
    (workspace) => workspace.projectKind,
  );

  const actionItems = useMemo(() => {
    return buildCommandCenterActionItems({
      open,
      query,
      currentWorkspaceRoute,
      currentWorkspaceKind,
      currentProjectKind,
      currentWorkspaceDraftRoute: currentWorkspaceDraftRoute as string | undefined,
      homeRoute: homeRoute as string | undefined,
      sessionsRoute: sessionsRoute as string | undefined,
      settingsRoute: settingsRoute as string,
      t,
      resolveShortcutKeys: (actionId) => resolveActionShortcutKeys(actionId, overrides),
    });
  }, [
    currentWorkspaceRoute,
    currentWorkspaceKind,
    currentProjectKind,
    currentWorkspaceDraftRoute,
    homeRoute,
    open,
    overrides,
    query,
    sessionsRoute,
    settingsRoute,
    t,
  ]);

  const items = useMemo(() => {
    if (!open) {
      return EMPTY_COMMAND_CENTER_ITEMS;
    }
    const next: CommandCenterItem[] = [];
    for (const action of actionItems) {
      next.push({
        kind: "action",
        action,
      });
    }
    for (const agent of agentResults) {
      next.push({
        kind: "agent",
        agent,
      });
    }
    return next;
  }, [actionItems, agentResults, open]);

  const handleClose = useCallback(() => {
    void import("@/desktop/electron/command-center-window-controls").then(
      ({ closeCommandCenter }) => closeCommandCenter(),
    );
  }, []);

  const handleSelectAgent = useCallback(
    (agent: AggregatedAgent) => {
      const target = resolveCommandCenterAgentTarget(agent);
      if (!target) {
        return;
      }
      didNavigateRef.current = true;

      // Don't restore focus back to the prior element after we navigate.
      clearCommandCenterFocusRestoreElement();
      void import("@/desktop/electron/command-center-window-controls").then(
        ({ closeCommandCenter }) => closeCommandCenter(),
      );
      navigateToAgent({
        serverId: target.serverId,
        agentId: target.agentId,
        currentPathname: pathname,
      });
    },
    [pathname],
  );

  const openProjectPicker = useOpenProjectPicker(activeServerId);

  const handleSelectAction = useCallback(
    (action: CommandCenterActionItem) => {
      clearCommandCenterFocusRestoreElement();
      void import("@/desktop/electron/command-center-window-controls").then(
        ({ closeCommandCenter }) => closeCommandCenter(),
      );
      if (action.id === "new-agent") {
        void openProjectPicker();
        return;
      }
      if (action.dispatchAction) {
        didNavigateRef.current = true;
        keyboardActionDispatcher.dispatch({
          id: action.dispatchAction,
          scope: action.dispatchAction.startsWith("worktree.") ? "sidebar" : "workspace",
        });
        return;
      }
      if (!action.route) {
        return;
      }
      didNavigateRef.current = true;
      router.push(action.route as Href);
    },
    [openProjectPicker],
  );

  const handleSelectItem = useCallback(
    (item: CommandCenterItem) => {
      if (item.kind === "action") {
        handleSelectAction(item.action);
        return;
      }
      handleSelectAgent(item.agent);
    },
    [handleSelectAction, handleSelectAgent],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    handleSelectItemRef.current = handleSelectItem;
  }, [handleSelectItem]);

  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (!open) {
      setQuery("");
      setActiveIndex(0);

      if (isWeb && prevOpen && !didNavigateRef.current) {
        const el = takeCommandCenterFocusRestoreElement();
        const isFocused = () =>
          Boolean(el) && typeof document !== "undefined" && document.activeElement === el;

        const cancel = focusWithRetries({
          focus: () => el?.focus(),
          isFocused,
          onTimeout: () => {
            keyboardActionDispatcher.dispatch({
              id: "message-input.focus",
              scope: "message-input",
            });
          },
        });
        return cancel;
      }

      return;
    }

    didNavigateRef.current = false;

    if (isWeb) {
      const id = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex >= items.length) {
      setActiveIndex(items.length > 0 ? items.length - 1 : 0);
    }
  }, [activeIndex, items.length, open]);

  useEffect(() => {
    if (!isWeb || !open) return;

    const handler = (event: KeyboardEvent) => {
      const currentItems = itemsRef.current;
      const key = event.key;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter" && key !== "Escape") {
        return;
      }

      if (key === "Escape") {
        event.preventDefault();
        handleCloseRef.current();
        return;
      }

      if (key === "Enter") {
        if (currentItems.length === 0) return;
        event.preventDefault();
        const index = Math.max(0, Math.min(activeIndexRef.current, currentItems.length - 1));
        handleSelectItemRef.current(currentItems[index]);
        return;
      }

      if (key === "ArrowDown" || key === "ArrowUp") {
        if (currentItems.length === 0) return;
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = key === "ArrowDown" ? 1 : -1;
          const next = current + delta;
          if (next < 0) return currentItems.length - 1;
          if (next >= currentItems.length) return 0;
          return next;
        });
      }
    };

    // react-native-web can stop propagation on key events, so listen in capture phase.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open]);

  return {
    open,
    inputRef,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    items,
    handleClose,
    handleSelectItem,
  };
}
