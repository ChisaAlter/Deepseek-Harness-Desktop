import { StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceRouteState } from "@/screens/workspace/workspace-route-state";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface WorkspaceRouteStateActions {
  onRetryHost: () => void;
  onManageHost: () => void;
  onDismissMissingWorkspace: () => void;
}

export function renderWorkspaceRouteGate(input: {
  state: WorkspaceRouteState;
  actions: WorkspaceRouteStateActions;
  /** When true, stuck connecting/idle gates expose retry recovery actions. */
  offerConnectionRecovery?: boolean;
}): React.ReactNode {
  switch (input.state.kind) {
    case "loading":
      return <WorkspaceConnecting hostName={input.state.hostName} />;
    case "unreachable":
      return (
        <WorkspaceUnreachable
          state={input.state}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
          offerConnectionRecovery={input.offerConnectionRecovery === true}
        />
      );
    case "missing":
      return (
        <WorkspaceMissing
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "ready":
    case "reconnecting":
      // Reconnecting keeps the workspace shell mounted; banner is rendered by the ready path.
      return null;
  }
}

/**
 * Non-blocking banner shown while a cached workspace stays open during host reconnect.
 */
export function WorkspaceReconnectingBanner({
  state,
  onRetry,
  onManageHost,
}: {
  state: Extract<WorkspaceRouteState, { kind: "reconnecting" }>;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const { t } = useTranslation();
  const canRetry = state.connectionStatus === "offline" || state.connectionStatus === "error";
  let title = t("workspace.routeState.unableToConnect", { host: state.hostName });
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    title = t("connection.reconnectingTo", { host: state.hostName });
  } else if (state.connectionStatus === "offline") {
    title = t("workspace.routeState.hostOffline", { host: state.hostName });
  }

  return (
    <View
      style={styles.reconnectingBanner}
      accessibilityRole="alert"
      testID="workspace-reconnecting-banner"
    >
      <View style={styles.reconnectingBannerBody}>
        {state.connectionStatus === "connecting" || state.connectionStatus === "idle" ? (
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        ) : null}
        <View style={styles.reconnectingTextStack}>
          <Text style={styles.reconnectingTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.reconnectingDescription} numberOfLines={2}>
            {state.lastError ? state.lastError : t("connection.reconnectingHint")}
          </Text>
        </View>
      </View>
      <View style={styles.reconnectingActions}>
        {canRetry ? (
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.retry")}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" leftIcon={Settings} onPress={onManageHost}>
          {t("workspace.routeState.manageHost")}
        </Button>
      </View>
    </View>
  );
}

function getWorkspaceHostStateTitle(
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    return t("workspace.routeState.connecting");
  }
  if (state.connectionStatus === "offline") {
    return t("workspace.routeState.hostOffline", { host: state.hostName });
  }
  return t("workspace.routeState.unableToConnect", { host: state.hostName });
}

function formatRouteConnectionStatus(
  status: Extract<WorkspaceRouteState, { kind: "unreachable" }>["connectionStatus"],
  t: (key: string) => string,
): string {
  return t(`workspace.routeState.status.${status}`);
}

function WorkspaceConnecting({ hostName }: { hostName: string }) {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState} testID="workspace-route-gate">
      <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("workspace.routeState.loadingWorkspace")}</Text>
        <Text style={styles.description}>{hostName}</Text>
      </View>
    </View>
  );
}

function WorkspaceUnreachable({
  state,
  onRetry,
  onManageHost,
  offerConnectionRecovery,
}: {
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>;
  onRetry: () => void;
  onManageHost: () => void;
  offerConnectionRecovery: boolean;
}) {
  const { t } = useTranslation();
  const isConnectingLike =
    state.connectionStatus === "connecting" || state.connectionStatus === "idle";
  const canRetry =
    state.connectionStatus === "offline" ||
    state.connectionStatus === "error" ||
    (isConnectingLike && offerConnectionRecovery);
  let description = t("workspace.routeState.hostStatus", {
    status: formatRouteConnectionStatus(state.connectionStatus, t),
  });
  if (isConnectingLike) {
    description = offerConnectionRecovery
      ? t("workspace.routeState.connectionTakingLonger", { host: state.hostName })
      : state.hostName;
  }

  return (
    <View style={styles.emptyState} testID="workspace-route-gate">
      {isConnectingLike ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>{getWorkspaceHostStateTitle(state, t)}</Text>
        <Text style={styles.description}>{description}</Text>
        {state.lastError ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Text style={styles.error} numberOfLines={3}>
                {state.lastError}
              </Text>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.errorTooltip}>{state.lastError}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      {canRetry ? (
        <View style={styles.actions}>
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.retry")}
          </Button>
          <Button size="sm" variant="outline" leftIcon={Settings} onPress={onManageHost}>
            {t("workspace.routeState.manageHost")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceMissing({ hostName, onDismiss }: { hostName: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState} testID="workspace-route-gate">
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("workspace.routeState.missingWorkspace")}</Text>
        <Text style={styles.description}>{hostName}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="sm" variant="default" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.back")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
  },
  errorTooltip: {
    color: theme.colors.popoverForeground,
    fontSize: 12.5,
    lineHeight: 16,
    maxWidth: 420,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  reconnectingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: RNStyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.statusWarningBg,
  },
  reconnectingBannerBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 200,
  },
  reconnectingTextStack: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  reconnectingTitle: {
    color: theme.colors.foreground,
    // Soft reconnect chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  reconnectingDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  reconnectingActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
