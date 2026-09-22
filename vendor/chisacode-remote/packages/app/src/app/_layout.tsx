/**
 * Root layout — thin orchestration layer that composes providers and the
 * app shell. All domain-specific providers, components, and hooks have been
 * extracted to independent modules under `_layout/`.
 */
import "@/styles/unistyles";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ErrorBoundary } from "@/components/error-boundary";
import { polyfillCrypto } from "@/polyfills/crypto";
import { AppShell } from "./_layout/AppShell";
import { RootProviders, RuntimeProviders } from "./_layout/ProvidersRoot";
import { layoutStyles } from "./_layout/AppContainer";

polyfillCrypto();

export {
  HostRuntimeBootstrapState,
  useStoreReady,
  useEarliestOnlineHostServerId,
  useHostRuntimeBootstrapState,
} from "./_layout/BootstrapProvider";

const flexStyle = { flex: 1 } as const;

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={flexStyle}>
      <View style={layoutStyles.surfaceFill}>
        <RootProviders>
          <RuntimeProviders>
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </RuntimeProviders>
        </RootProviders>
      </View>
    </GestureHandlerRootView>
  );
}
