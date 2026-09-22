import { type ReactNode, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { LayoutAnimation } from "react-native";
import { UnistylesRuntime } from "react-native-unistyles";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { PortalProvider } from "@gorhom/portal";
import { VoiceProvider } from "@/contexts/voice-context";
import { SidebarCalloutProvider } from "@/contexts/sidebar-callout-context";
import { ToastProvider } from "@/contexts/toast-context";
import { useSettings } from "@/hooks/use-settings";
import { appI18n } from "@/i18n";
import { queryClient } from "@/query/query-client";
import { useHostMutations } from "@/runtime/host-runtime";
import { isNative } from "@/constants/platform";
import { THEME_TO_UNISTYLES } from "@/styles/theme";
import { HostRuntimeBootstrapProvider } from "./BootstrapProvider";
import { PushNotificationRouter } from "./Notifications";
import { HostSessionManager } from "./ManagedDaemonSession";
import { DesktopWindowControlsSync } from "./SyncComponents";
import { FaviconStatusSync } from "./SyncComponents";
import { StatusBarThemeSync } from "./SyncComponents";
import { OfferLinkListener } from "./LinkListeners";

function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function ProvidersWrapper({ children }: { children: ReactNode }) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { upsertConnectionFromOfferUrl } = useHostMutations();

  // Apply theme setting on mount and when it changes
  useEffect(() => {
    if (settingsLoading) return;
    if (isNative) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    if (settings.theme === "auto") {
      UnistylesRuntime.setAdaptiveThemes(true);
    } else {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[settings.theme]);
    }
  }, [settingsLoading, settings.theme]);

  useEffect(() => {
    if (settingsLoading) return;
    void appI18n.changeLanguage(settings.language);
  }, [settings.language, settingsLoading]);

  return (
    <I18nextProvider i18n={appI18n}>
      <VoiceProvider>
        <DesktopWindowControlsSync enabled={!settingsLoading} />
        <OfferLinkListener upsertDaemonFromOfferUrl={upsertConnectionFromOfferUrl} />
        <HostSessionManager />
        <FaviconStatusSync />
        <StatusBarThemeSync />
        {children}
      </VoiceProvider>
    </I18nextProvider>
  );
}

function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <HostRuntimeBootstrapProvider>
      <PushNotificationRouter />
      <SidebarCalloutProvider>
        <ToastProvider>
          <ProvidersWrapper>{children}</ProvidersWrapper>
        </ToastProvider>
      </SidebarCalloutProvider>
    </HostRuntimeBootstrapProvider>
  );
}

// PortalProvider must remain the innermost global provider here.
// `@gorhom/portal` renders portaled children at the host's location in the
// tree, so any context a portaled sheet might consume (QueryClient, theme,
// auth, settings, …) must wrap PortalProvider — not be wrapped by it.
// Adding a new global provider? Put it above PortalProvider.
function RootProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SafeAreaProvider>
        <KeyboardProvider>
          <PortalProvider>{children}</PortalProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </QueryProvider>
  );
}

export { QueryProvider, ProvidersWrapper, RuntimeProviders, RootProviders };
