import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import type { DesktopPermissionStatus } from "@/desktop/permissions/desktop-permissions";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface DesktopPermissionRowProps {
  title: string;
  status: DesktopPermissionStatus | null;
  isRequesting: boolean;
  showBorder?: boolean;
  onRequest: () => void;
  extraActionLabel?: string;
  isExtraActionBusy?: boolean;
  isExtraActionDisabled?: boolean;
  onExtraAction?: () => void;
}

export function DesktopPermissionRow({
  title,
  status,
  isRequesting,
  showBorder,
  onRequest,
  extraActionLabel,
  isExtraActionBusy = false,
  isExtraActionDisabled = false,
  onExtraAction,
}: DesktopPermissionRowProps) {
  const { t } = useTranslation();
  const state = status?.state ?? "unknown";
  const isGranted = state === "granted";
  const shouldShowDetail =
    status !== null &&
    status.detail.trim().length > 0 &&
    state !== "granted" &&
    state !== "prompt" &&
    state !== "not-granted";

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.permissionRowActions}>
        {isGranted ? (
          <View style={styles.permissionGrantedActions}>
            <View style={styles.permissionStatusPill}>
              <ThemedCheck size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.permissionStatusText}>{t("settings.permissions.granted")}</Text>
            </View>
            {extraActionLabel && onExtraAction ? (
              <Button
                variant="outline"
                size="sm"
                onPress={onExtraAction}
                disabled={isExtraActionDisabled || isExtraActionBusy}
              >
                {isExtraActionBusy ? `${extraActionLabel}...` : extraActionLabel}
              </Button>
            ) : null}
          </View>
        ) : (
          <Button variant="outline" size="sm" onPress={onRequest} disabled={isRequesting}>
            {isRequesting
              ? t("settings.permissions.requesting")
              : t("settings.permissions.request")}
          </Button>
        )}
        {shouldShowDetail ? (
          <Text style={styles.permissionDetailText}>{status?.detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  permissionRowActions: {
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  permissionGrantedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  permissionStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    minWidth: 88,
    justifyContent: "center",
  },
  permissionStatusText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  permissionDetailText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    maxWidth: 220,
    textAlign: "right",
  },
}));
