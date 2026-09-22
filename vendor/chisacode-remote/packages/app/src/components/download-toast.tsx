import { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, X, XCircle } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useDownloadStore, formatSpeed, formatEta, type Download } from "@/stores/download-store";
import { SPACING, type Theme } from "@/styles/theme";

const AUTO_DISMISS_DELAY = 3000;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCheck = withUnistyles(Check);
const ThemedXCircle = withUnistyles(XCircle);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const primaryColorMapping = (theme: Theme) => ({
  color: theme.colors.primary,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function getDownloadStatusText(download: Download, t: (key: string) => string): string {
  if (download.status === "downloading") {
    if (download.progress) {
      return `${Math.round(download.progress.percent * 100)}% · ${formatSpeed(download.progress.speed)} · ${formatEta(download.progress.eta)}`;
    }
    return t("common.downloadStarting");
  }
  if (download.status === "complete") return t("common.downloadComplete");
  return download.message ?? t("common.downloadFailed");
}

export function DownloadToast() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const downloads = useDownloadStore((state) => state.downloads);
  const activeDownloadId = useDownloadStore((state) => state.activeDownloadId);
  const dismissDownload = useDownloadStore((state) => state.dismissDownload);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDownload = activeDownloadId ? downloads.get(activeDownloadId) : null;

  useEffect(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }

    if (activeDownload && activeDownload.status !== "downloading") {
      dismissTimeoutRef.current = setTimeout(() => {
        dismissDownload(activeDownload.id);
      }, AUTO_DISMISS_DELAY);
    }

    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, [activeDownload, dismissDownload]);

  const containerStyle = useMemo(
    () => [styles.container, { bottom: SPACING[4] + insets.bottom }],
    [insets.bottom],
  );

  const handleDismiss = useCallback(() => {
    if (activeDownload) {
      dismissDownload(activeDownload.id);
    }
  }, [activeDownload, dismissDownload]);

  if (!activeDownload) {
    return null;
  }

  return (
    <View style={containerStyle} pointerEvents="box-none">
      <View style={styles.toast}>
        {activeDownload.status === "downloading" ? (
          <ThemedActivityIndicator size="small" uniProps={foregroundColorMapping} />
        ) : null}
        {activeDownload.status === "complete" ? (
          <ThemedCheck size={18} uniProps={primaryColorMapping} />
        ) : null}
        {activeDownload.status !== "downloading" && activeDownload.status !== "complete" ? (
          <ThemedXCircle size={18} uniProps={destructiveColorMapping} />
        ) : null}
        <View style={styles.textContainer}>
          <Text style={styles.fileName} numberOfLines={1}>
            {activeDownload.fileName}
          </Text>
          <Text style={styles.status}>{getDownloadStatusText(activeDownload, t)}</Text>
          {activeDownload.status === "downloading" && activeDownload.progress && (
            <View style={styles.progressBar}>
              <ProgressFill percent={activeDownload.progress.percent} />
            </View>
          )}
        </View>
        {activeDownload.status !== "downloading" && (
          <Pressable onPress={handleDismiss} hitSlop={8} style={styles.dismiss}>
            <ThemedX size={16} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ProgressFill({ percent }: { percent: number }) {
  const width: `${number}%` = `${Math.round(percent * 100)}%`;
  const fillStyle = useMemo(() => [styles.progressFill, { width }], [width]);
  return <View style={fillStyle} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: theme.spacing[4],
    right: theme.spacing[4],
    zIndex: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    ...theme.shadow.sm,
  },
  textContainer: {
    flex: 1,
    gap: theme.spacing[1],
  },
  fileName: {
    color: theme.colors.foreground,
    // Soft toast body: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.semibold,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  progressBar: {
    height: 3,
    backgroundColor: theme.colors.surfaceWorkspace,
    borderRadius: theme.borderRadius.full,
    marginTop: theme.spacing[1],
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
  },
  dismiss: {
    padding: theme.spacing[1],
  },
}));
