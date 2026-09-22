import { type ReactNode, useEffect, useMemo } from "react";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  useRouter,
} from "expo-router";
import { withUnistyles } from "react-native-unistyles";
import { SidebarAnimationProvider } from "@/contexts/sidebar-animation-context";
import { HorizontalScrollProvider } from "@/contexts/horizontal-scroll-context";
import { useHosts } from "@/runtime/host-runtime";
import { resolveActiveHostRedirectRoute } from "@/utils/host-runtime-bootstrap";
import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
  parseSettingsHostRouteFromPathname,
  parseWorkspaceOpenIntent,
} from "@/utils/host-routes";
import { useSelectedSidebarAgentIdFromWorkspaceLayout } from "@/utils/selected-sidebar-agent";
import type { Theme } from "@/styles/theme";
import { AppContainer } from "./AppContainer";
import { useStoreReady } from "./BootstrapProvider";
import { OpenProjectListener } from "./LinkListeners";
import { resolveAppSurfaceBackgrounds } from "./app-surface-backgrounds";

function AppWithSidebar({ children }: { children: ReactNode }) {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ open?: string | string[] }>();
  const hosts = useHosts();
  const storeReady = useStoreReady();
  const chromeServerId = useMemo(() => parseServerIdFromPathname(pathname), [pathname]);
  const activeServerId = useMemo(
    () => chromeServerId ?? parseSettingsHostRouteFromPathname(pathname),
    [chromeServerId, pathname],
  );
  const workspaceRoute = useMemo(() => parseHostWorkspaceRouteFromPathname(pathname), [pathname]);
  const selectedWorkspaceAgentId = useSelectedSidebarAgentIdFromWorkspaceLayout(workspaceRoute);
  const selectedWorkspaceAgentKey = useMemo(() => {
    if (!workspaceRoute || !selectedWorkspaceAgentId) {
      return undefined;
    }
    return `${workspaceRoute.serverId}:${selectedWorkspaceAgentId}`;
  }, [selectedWorkspaceAgentId, workspaceRoute]);
  const shouldShowAppChrome =
    storeReady && chromeServerId !== null && hosts.some((host) => host.serverId === chromeServerId);

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }
    const redirectRoute = resolveActiveHostRedirectRoute({
      pathname,
      activeServerId,
      hostServerIds: hosts.map((host) => host.serverId),
    });
    if (!redirectRoute) {
      return;
    }
    const handle = setTimeout(() => {
      router.replace(redirectRoute);
    }, 0);
    return () => clearTimeout(handle);
  }, [activeServerId, hosts, pathname, rootNavigationState?.key, router]);

  // Parse selectedAgentKey directly from pathname
  // useLocalSearchParams doesn't update when navigating between same-pattern routes
  const selectedAgentKey = useMemo(() => {
    const match = parseHostAgentRouteFromPathname(pathname);
    if (match) {
      return `${match.serverId}:${match.agentId}`;
    }

    if (selectedWorkspaceAgentKey) {
      return selectedWorkspaceAgentKey;
    }

    const openValue = Array.isArray(params.open) ? params.open[0] : params.open;
    const openIntent = parseWorkspaceOpenIntent(openValue);
    if (workspaceRoute && openIntent?.kind === "agent") {
      const agentId = openIntent.agentId.trim();
      return agentId ? `${workspaceRoute.serverId}:${agentId}` : undefined;
    }

    return undefined;
  }, [params.open, pathname, selectedWorkspaceAgentKey, workspaceRoute]);

  return (
    <AppContainer
      selectedAgentId={shouldShowAppChrome ? selectedAgentKey : undefined}
      chromeEnabled={shouldShowAppChrome}
    >
      {children}
    </AppContainer>
  );
}

const AGENT_SCREEN_OPTIONS = { gestureEnabled: false };

interface RootStackViewProps {
  storeReady: boolean;
  stackBackground: string;
  isDark: boolean;
  glassEnabled: boolean;
}

function RootStackView({ storeReady, stackBackground, isDark, glassEnabled }: RootStackViewProps) {
  const stackScreenOptions = useMemo(
    () => ({
      headerShown: false,
      animation: "none" as const,
      contentStyle: {
        flex: 1,
        backgroundColor: stackBackground,
      },
    }),
    [stackBackground],
  );
  const navigationTheme = useMemo(() => {
    const baseTheme = isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: stackBackground,
        card: glassEnabled ? "transparent" : baseTheme.colors.card,
      },
    };
  }, [stackBackground, glassEnabled, isDark]);
  return (
    <ThemeProvider value={navigationTheme}>
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={storeReady}>
          <Stack.Screen name="welcome" />
          <Stack.Screen name="pair-scan" />
        </Stack.Protected>
        {/*
        Do not add getId or dangerouslySingular back to the workspace route.
        Expo Router maps dangerouslySingular to React Navigation getId, and
        getId repeatedly breaks Android native-stack/Fabric by reordering an
        already-mounted workspace screen. Keep workspace identity/retention
        outside this route-level native-stack API.
      */}
        <Stack.Screen name="h/[serverId]/workspace/[workspaceId]/index" />
        <Stack.Screen name="h/[serverId]/agent/[agentId]" options={AGENT_SCREEN_OPTIONS} />
        <Stack.Screen name="h/[serverId]/index" />
        <Stack.Screen name="h/[serverId]/sessions" />
        <Stack.Screen name="h/[serverId]/open-project" />
        <Stack.Screen name="h/[serverId]/settings" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/[section]" />
        <Stack.Screen name="settings/projects/index" />
        <Stack.Screen name="settings/projects/[projectKey]" />
        <Stack.Screen name="settings/hosts/[serverId]" />
      </Stack>
    </ThemeProvider>
  );
}

const rootStackThemeMapping = (theme: Theme) => {
  const stackBackground = resolveAppSurfaceBackgrounds({
    frameEnabled: false,
    glassEnabled: theme.glass.enabled,
    surfaceWorkspace: theme.colors.surfaceWorkspace,
    surface0: theme.colors.surface0,
    glassShell: theme.glass.shell,
    borderAccent: theme.colors.border,
  }).stack;
  return {
    stackBackground,
    isDark: theme.isDark,
    glassEnabled: theme.glass.enabled,
  };
};

const ThemedRootStackView = withUnistyles(RootStackView);

function RootStack() {
  const storeReady = useStoreReady();
  return <ThemedRootStackView storeReady={storeReady} uniProps={rootStackThemeMapping} />;
}

function AppShell() {
  return (
    <SidebarAnimationProvider>
      <HorizontalScrollProvider>
        <OpenProjectListener />
        <AppWithSidebar>
          <RootStack />
        </AppWithSidebar>
      </HorizontalScrollProvider>
    </SidebarAnimationProvider>
  );
}

export { AppWithSidebar, AGENT_SCREEN_OPTIONS, RootStack, AppShell };
