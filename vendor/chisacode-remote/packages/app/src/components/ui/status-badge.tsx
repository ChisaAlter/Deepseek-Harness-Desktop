import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

type StatusBadgeVariant = "success" | "warning" | "error" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  accessibilityLabel?: string;
}

function normalizeStatusBadgeLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : "Status";
}

function normalizeOptionalStatusBadgeLabel(label: string | null | undefined): string | null {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatusBadgeVariant(variant: StatusBadgeVariant): StatusBadgeVariant {
  if (variant === "success" || variant === "warning" || variant === "error") {
    return variant;
  }
  return "muted";
}

export function StatusBadge({ label, variant = "muted", accessibilityLabel }: StatusBadgeProps) {
  const displayLabel = normalizeStatusBadgeLabel(label);
  const normalizedVariant = normalizeStatusBadgeVariant(variant);
  const normalizedAccessibilityLabel =
    normalizeOptionalStatusBadgeLabel(accessibilityLabel) ?? displayLabel;
  const pillStyle = useMemo(
    () => [
      styles.pill,
      normalizedVariant === "success" && styles.pillSuccess,
      normalizedVariant === "warning" && styles.pillWarning,
      normalizedVariant === "error" && styles.pillError,
    ],
    [normalizedVariant],
  );
  const textStyle = useMemo(
    () => [
      styles.pillText,
      normalizedVariant === "success" && styles.pillTextSuccess,
      normalizedVariant === "warning" && styles.pillTextWarning,
      normalizedVariant === "error" && styles.pillTextError,
    ],
    [normalizedVariant],
  );

  return (
    <View
      accessible
      accessibilityLabel={normalizedAccessibilityLabel}
      accessibilityRole="text"
      style={pillStyle}
    >
      <Text style={textStyle} numberOfLines={1} ellipsizeMode="tail">
        {displayLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .badge — quiet pill on shell.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  pillSuccess: {
    backgroundColor: theme.colors.statusSuccessBg,
    borderColor: "rgba(34, 197, 94, 0.22)",
  },
  pillWarning: {
    backgroundColor: theme.colors.statusWarningBg,
    borderColor: "rgba(245, 158, 11, 0.22)",
  },
  pillError: {
    backgroundColor: theme.colors.statusDangerBg,
    borderColor: "rgba(239, 68, 68, 0.22)",
  },
  pillText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  pillTextSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillTextWarning: {
    color: theme.colors.statusWarning,
  },
  pillTextError: {
    color: theme.colors.statusDanger,
  },
}));
