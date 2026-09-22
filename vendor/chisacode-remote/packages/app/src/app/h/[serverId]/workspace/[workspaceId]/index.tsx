import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  useGlobalSearchParams,
  useLocalSearchParams,
  useNavigation,
  useRootNavigationState,
} from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  type ActiveWorkspaceSelection,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import { WorkspaceScreen } from "@/screens/workspace/workspace-screen";
import { useWorkspaceLayoutStoreHydrated } from "@/stores/workspace-layout-store";
import {
  decodeWorkspaceIdFromPathSegment,
  isWorkspaceScreenOpenIntent,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { isWeb } from "@/constants/platform";

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function getOpenIntentTarget(openIntent: WorkspaceOpenIntent): WorkspaceTabTarget | null {
  if (openIntent.kind === "changes" || openIntent.kind === "terminal-new") {
    return null;
  }
  if (openIntent.kind === "agent") {
    return { kind: "agent", agentId: openIntent.agentId };
  }
  if (openIntent.kind === "terminal") {
    return { kind: "terminal", terminalId: openIntent.terminalId };
  }
  if (openIntent.kind === "file") {
    return { kind: "file", path: openIntent.path };
  }
  if (openIntent.kind === "setup") {
    return { kind: "setup", workspaceId: openIntent.workspaceId };
  }
  return { kind: "draft", draftId: openIntent.draftId };
}

function stripOpenSearchParamFromBrowserUrl() {
  if (!isWeb || typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has("open")) {
    return;
  }
  url.searchParams.delete("open");
  window.history.replaceState(null, "", url.toString());
}

function clearConsumedOpenIntent(input: {
  navigation: { setParams: (params: { open?: string | undefined }) => void };
}) {
  input.navigation.setParams({ open: undefined });
  if (isWeb) {
    stripOpenSearchParamFromBrowserUrl();
  }
}

export default function HostWorkspaceIndexRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostWorkspaceRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostWorkspaceRouteContent() {
  const navigation = useNavigation();
  const rootNavigationState = useRootNavigationState();
  const hasHydratedWorkspaceLayoutStore = useWorkspaceLayoutStoreHydrated();
  const consumedIntentRef = useRef<string | null>(null);
  const [intentConsumed, setIntentConsumed] = useState(false);
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const globalParams = useGlobalSearchParams<{
    open?: string | string[];
  }>();
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = workspaceValue
    ? (decodeWorkspaceIdFromPathSegment(workspaceValue) ?? "")
    : "";
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasHydratedWorkspaces = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false,
  );
  const openValue = getParamValue(globalParams.open);
  useEffect(() => {
    if (!openValue) {
      return;
    }
    if (!rootNavigationState?.key) {
      return;
    }
    if (!hasHydratedWorkspaceLayoutStore) {
      return;
    }

    const consumptionKey = `${serverId}:${workspaceId}:${openValue}`;
    if (consumedIntentRef.current === consumptionKey) {
      clearConsumedOpenIntent({
        navigation: navigation as unknown as {
          setParams: (params: { open?: string | undefined }) => void;
        },
      });
      setIntentConsumed(true);
      return;
    }
    consumedIntentRef.current = consumptionKey;

    const openIntent = parseWorkspaceOpenIntent(openValue);
    if (openIntent && isWorkspaceScreenOpenIntent(openIntent)) {
      setIntentConsumed(true);
      return;
    }
    if (openIntent) {
      const target = getOpenIntentTarget(openIntent);
      if (target) {
        prepareWorkspaceTab({
          serverId,
          workspaceId,
          target,
          pin: openIntent.kind === "agent",
        });
      }
    }

    // Expo Router's replace ignores query-param-only changes (findDivergentState
    // skips search params). Strip ?open from the browser URL directly so the
    // address bar reflects the clean workspace route.
    clearConsumedOpenIntent({
      navigation: navigation as unknown as {
        setParams: (params: { open?: string | undefined }) => void;
      },
    });

    setIntentConsumed(true);
  }, [
    hasHydratedWorkspaceLayoutStore,
    navigation,
    openValue,
    rootNavigationState?.key,
    serverId,
    workspaceId,
  ]);

  const openIntent = parseWorkspaceOpenIntent(openValue);
  const shouldWaitForRouteIntent =
    openValue && (!openIntent || !isWorkspaceScreenOpenIntent(openIntent));

  if (shouldWaitForRouteIntent && (!intentConsumed || !hasHydratedWorkspaceLayoutStore)) {
    return null;
  }

  if (serverId && isConnected && !hasHydratedWorkspaces) {
    return null;
  }

  return <WorkspaceDeck />;
}

function areWorkspaceSelectionsEqual(
  left: ActiveWorkspaceSelection | null,
  right: ActiveWorkspaceSelection | null,
): boolean {
  return left?.serverId === right?.serverId && left?.workspaceId === right?.workspaceId;
}

function WorkspaceDeck() {
  const activeSelection = useActiveWorkspaceSelection();
  const [mountedSelections, setMountedSelections] = useState<ActiveWorkspaceSelection[]>(() =>
    activeSelection ? [activeSelection] : [],
  );

  useEffect(() => {
    if (!activeSelection) {
      return;
    }
    setMountedSelections((current) => {
      if (current.some((selection) => areWorkspaceSelectionsEqual(selection, activeSelection))) {
        return current;
      }
      return [...current, activeSelection];
    });
  }, [activeSelection]);

  if (!activeSelection) {
    return null;
  }

  return (
    <View style={styles.deck}>
      {mountedSelections.map((selection) => {
        const isActive = areWorkspaceSelectionsEqual(selection, activeSelection);
        return (
          <View
            key={`${selection.serverId}:${selection.workspaceId}`}
            style={isActive ? styles.activeDeckEntry : styles.inactiveDeckEntry}
            testID={`workspace-deck-entry-${selection.serverId}:${selection.workspaceId}`}
          >
            <WorkspaceScreen
              serverId={selection.serverId}
              workspaceId={selection.workspaceId}
              isRouteFocused={isActive}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
  },
  activeDeckEntry: {
    flex: 1,
  },
  inactiveDeckEntry: {
    display: "none",
    flex: 1,
  },
});
