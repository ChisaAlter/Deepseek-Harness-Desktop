import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react-native";
import { type ReactNode, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";

export interface AlertProps {
  title?: string;
  description?: ReactNode;
  variant?: AlertVariant;
  icon?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

const ThemedInfo = withUnistyles(Info);
const ThemedCheckCircle2 = withUnistyles(CheckCircle2);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedXCircle = withUnistyles(XCircle);

const VARIANT_THEMED_ICON = {
  info: ThemedInfo,
  success: ThemedCheckCircle2,
  warning: ThemedAlertTriangle,
  error: ThemedXCircle,
} as const;

const infoAccentMapping = (theme: Theme) => ({
  color: theme.colors.palette.blue[300],
});
const successAccentMapping = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
});
const warningAccentMapping = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
});
const errorAccentMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

function resolveAccentColorMapping(
  variant: AlertVariant,
): ((theme: Theme) => { color: string }) | null {
  if (variant === "info") return infoAccentMapping;
  if (variant === "success") return successAccentMapping;
  if (variant === "warning") return warningAccentMapping;
  if (variant === "error") return errorAccentMapping;
  return null;
}

function resolveContainerStyle(variant: AlertVariant) {
  if (variant === "info") return styles.containerInfo;
  if (variant === "success") return styles.containerSuccess;
  if (variant === "warning") return styles.containerWarning;
  if (variant === "error") return styles.containerError;
  return null;
}

function resolveTitleStyle(variant: AlertVariant) {
  if (variant === "info") return styles.titleInfo;
  if (variant === "success") return styles.titleSuccess;
  if (variant === "warning") return styles.titleWarning;
  if (variant === "error") return styles.titleError;
  return null;
}

export function Alert({
  title,
  description,
  variant = "default",
  icon,
  children,
  testID,
}: AlertProps) {
  const accentMapping = resolveAccentColorMapping(variant);

  const containerStyle = useMemo(
    () => [styles.container, resolveContainerStyle(variant)],
    [variant],
  );

  const titleStyle = useMemo(() => [styles.title, resolveTitleStyle(variant)], [variant]);

  const resolvedIcon = useMemo(() => {
    if (icon !== undefined) return icon;
    if (variant === "default") return null;
    const Icon = VARIANT_THEMED_ICON[variant];
    return <Icon size={ICON_SIZE.sm} uniProps={accentMapping ?? foregroundColorMapping} />;
  }, [icon, variant, accentMapping]);

  const hasDescription = description != null && description !== "";

  return (
    <View style={containerStyle} testID={testID} accessibilityRole="alert">
      {resolvedIcon ? <View style={styles.iconSlot}>{resolvedIcon}</View> : null}
      <View style={styles.body}>
        {title ? <Text style={titleStyle}>{title}</Text> : null}
        {hasDescription && typeof description === "string" ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
        {hasDescription && typeof description !== "string" ? (
          <View style={styles.descriptionSlot}>{description}</View>
        ) : null}
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .card-like alert: elevated surface, quiet border.
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    borderRadius: 14,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  containerInfo: {
    borderColor: theme.colors.palette.blue[300],
  },
  containerSuccess: {
    borderColor: theme.colors.palette.green[400],
  },
  containerWarning: {
    borderColor: theme.colors.palette.amber[500],
  },
  containerError: {
    borderColor: theme.colors.destructive,
  },
  iconSlot: {
    paddingTop: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
  },
  titleInfo: {
    color: theme.colors.palette.blue[300],
  },
  titleSuccess: {
    color: theme.colors.palette.green[400],
  },
  titleWarning: {
    color: theme.colors.palette.amber[500],
  },
  titleError: {
    color: theme.colors.destructive,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  descriptionSlot: {
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
