import React, { useEffect, useMemo, useState } from "react";
import { Redirect, usePathname } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import { resolveStartupRedirectRoute } from "@/utils/host-runtime-bootstrap";
import {
  forgetLastWorkspaceSelection,
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-execution";
import { buildHostNewWorkspaceRoute } from "@/utils/host-routes";

const isDesktop = shouldUseDesktopDaemon();
const HARD_ESCAPE_TIMEOUT_MS = 8_000;
const HARD_ESCAPE_SPLASH_ERROR =
  "Timed out waiting for the local daemon. Tap retry or check that the desktop daemon is running.";

export default function Index() {
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const isWorkspaceSelectionValidationPending = useSessionStore((state) => {
    if (!workspaceSelection) {
      return false;
    }
    const session = state.sessions[workspaceSelection.serverId];
    return session?.hasHydratedWorkspaces !== true;
  });
  const workspaceSelectionExists = useSessionStore((state) => {
    if (!workspaceSelection) {
      return false;
    }
    return Boolean(
      resolveWorkspaceMapKeyByIdentity({
        workspaces: state.sessions[workspaceSelection.serverId]?.workspaces,
        workspaceId: workspaceSelection.workspaceId,
      }),
    );
  });
  useEffect(() => {
    if (
      !workspaceSelection ||
      !isWorkspaceSelectionLoaded ||
      isWorkspaceSelectionValidationPending ||
      workspaceSelectionExists
    ) {
      return;
    }
    forgetLastWorkspaceSelection();
  }, [
    isWorkspaceSelectionLoaded,
    isWorkspaceSelectionValidationPending,
    workspaceSelection,
    workspaceSelectionExists,
  ]);

  // 启动不再恢复上次 workspace 的草稿 tab，统一走 Soft Home (/new)。
  // /new 路由内部会从 last-draft-directory-store 读取上次草稿所选目录作为初始值，
  // 让「启动默认草稿」和「点新对话」落到同一个目录。
  const redirectRoute = resolveStartupRedirectRoute({
    pathname,
    anyOnlineHostServerId,
    workspaceSelection: null,
    isWorkspaceSelectionLoaded,
    isWorkspaceSelectionValidationPending,
    workspaceSelectionExists,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
    isDesktop,
  });

  // Hard escape hatch: if bootstrap never unlatches (hung hydrate / hung
  // daemon-start / missed give-up), leave the pure-logo splash after a short
  // absolute timeout so the user is never stuck with no UI.
  const [hardEscape, setHardEscape] = useState(false);
  useEffect(() => {
    if (redirectRoute || hardEscape) {
      return;
    }
    const handle = setTimeout(() => {
      setHardEscape(true);
    }, HARD_ESCAPE_TIMEOUT_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [redirectRoute, hardEscape]);

  const hardEscapeBootstrapState = useMemo(
    () => ({
      ...bootstrapState,
      splashError: bootstrapState.splashError ?? HARD_ESCAPE_SPLASH_ERROR,
    }),
    [bootstrapState],
  );

  if (redirectRoute) {
    return <Redirect href={redirectRoute} />;
  }

  if (hardEscape) {
    if (anyOnlineHostServerId) {
      return <Redirect href={buildHostNewWorkspaceRoute(anyOnlineHostServerId)} />;
    }
    // Desktop is hard-bound to its built-in daemon: never redirect to the
    // welcome route. Stay on the retryable splash so the user can retry the
    // daemon start or open settings to add a remote host manually.
    if (isDesktop) {
      return <StartupSplashScreen bootstrapState={hardEscapeBootstrapState} />;
    }
    if (bootstrapState.storeReady) {
      return <Redirect href="/welcome" />;
    }
    // storeReady is still false so /welcome is Stack.Protected — show a
    // retryable error on the splash instead of an infinite pure logo.
    return <StartupSplashScreen bootstrapState={hardEscapeBootstrapState} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
