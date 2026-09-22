import { StyleSheet } from "react-native-unistyles";
import { WORKBENCH_META_LINE_HEIGHT } from "@/constants/layout";

export const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  compactContainer: {
    minWidth: 0,
    flexWrap: "wrap",
    alignItems: "center",
  },
  // Soft .t-btn: pill, transparent, muted text, hover wash.
  modeBadge: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full,
  },
  modeIconBadge: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: 10,
  },
  modeBadgeHovered: {
    backgroundColor: theme.colors.surface1,
  },
  modeBadgePressed: {
    backgroundColor: theme.colors.surface1,
  },
  disabledBadge: {
    opacity: 0.5,
  },
  modeBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  prefsButton: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
  },
  prefsButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  sheetSection: {
    gap: theme.spacing[2],
  },
  sheetSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  sheetSelectPressed: {
    backgroundColor: theme.colors.surface1,
  },
  disabledSheetSelect: {
    opacity: 0.5,
  },
  sheetSelectText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.semibold,
  },
}));
