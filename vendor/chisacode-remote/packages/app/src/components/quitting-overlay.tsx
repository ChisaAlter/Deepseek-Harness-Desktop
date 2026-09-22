import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getIsElectronRuntime } from "@/constants/layout";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function QuittingOverlay() {
  const { t } = useTranslation();
  const [quitting, setQuitting] = useState(false);

  useEffect(() => {
    if (!getIsElectronRuntime()) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenToDesktopEvent("quitting", () => {
      if (!cancelled) setQuitting(true);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!quitting) return null;

  return (
    <View style={styles.overlay}>
      <ThemedLoadingSpinner size="large" uniProps={foregroundMutedColorMapping} />
      <Text style={styles.title}>{t("desktop.quittingTitle")}</Text>
      <Text style={styles.detail}>{t("desktop.stoppingDaemon")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    zIndex: 9999,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
