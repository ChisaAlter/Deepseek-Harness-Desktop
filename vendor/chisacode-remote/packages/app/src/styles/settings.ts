import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import {
  SETTINGS_HINT_LINE_HEIGHT,
  SETTINGS_ROW_HORIZONTAL_PADDING,
  SETTINGS_ROW_TITLE_FONT_SIZE,
  SETTINGS_ROW_TITLE_LINE_HEIGHT,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[4],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  // Soft .lead / section label: 13 muted, not uppercase chrome.
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  // Soft section header: 13 medium muted.
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0,
    textTransform: "none",
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  sectionHeaderLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  // Soft Workbench .card: quiet elevated surface on soft shell.
  card: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        } as object)
      : theme.shadow.sm),
  },
  // Soft .row: min-height 56, pad 12 16, quiet dividers.
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: SETTINGS_ROW_HORIZONTAL_PADDING,
  },
  rowBorder: {
    borderTopWidth: 1 / UnistylesRuntime.pixelRatio,
    // Soft .row: quiet --border-soft divider inside elevated cards.
    borderTopColor: theme.colors.secondary,
  },
  rowContent: {
    flex: 1,
    marginRight: theme.spacing[4],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: SETTINGS_ROW_TITLE_FONT_SIZE,
    lineHeight: SETTINGS_ROW_TITLE_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  // Soft .row .hint: 12 muted under title.
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: SETTINGS_HINT_LINE_HEIGHT,
    marginTop: theme.spacing[0.5],
  },
}));
