import { X } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

export type SidebarCalloutActionVariant = "primary" | "secondary";

export interface SidebarCalloutAction {
  label: string;
  onPress: () => void;
  variant?: SidebarCalloutActionVariant;
  disabled?: boolean;
  testID?: string;
}

export type SidebarCalloutVariant = "default" | "success" | "error";

export interface SidebarCalloutProps {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
  variant?: SidebarCalloutVariant;
  actions?: readonly SidebarCalloutAction[];
  onDismiss?: () => void;
  testID?: string;
}

const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function SidebarCalloutDescriptionText({ children }: { children: ReactNode }) {
  return <Text style={styles.description}>{children}</Text>;
}

export function SidebarCallout({
  title,
  description,
  icon,
  variant = "default",
  actions,
  onDismiss,
  testID,
}: SidebarCalloutProps) {
  const visibleActions = (actions ?? []).slice(0, 2);
  const hasHeader = title != null || icon != null;
  const hasDescription = description != null && description !== "";

  const containerStyle = useMemo(
    () => [styles.container, variant === "error" ? styles.containerError : null],
    [variant],
  );

  return (
    <View style={containerStyle} testID={testID} accessibilityRole="alert">
      <View style={styles.body}>
        {hasHeader || onDismiss ? (
          <View style={styles.topRow}>
            {hasHeader ? (
              <View style={styles.header}>
                {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
                {title ? (
                  <Text style={styles.title} numberOfLines={2}>
                    {title}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {onDismiss ? (
              <Pressable
                onPress={onDismiss}
                hitSlop={8}
                style={styles.dismissButton}
                testID={testID ? `${testID}-dismiss` : undefined}
                accessibilityLabel="Dismiss"
                accessibilityRole="button"
              >
                {({ hovered }) => (
                  <ThemedX
                    size={14}
                    uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {hasDescription && typeof description === "string" ? (
          <SidebarCalloutDescriptionText>{description}</SidebarCalloutDescriptionText>
        ) : null}
        {hasDescription && typeof description !== "string" ? (
          <View style={styles.descriptionSlot}>{description}</View>
        ) : null}

        {visibleActions.length > 0 ? (
          <View style={styles.actionRow} testID={testID ? `${testID}-actions` : undefined}>
            {visibleActions.map((action, index) => (
              <SidebarCalloutActionButton
                key={action.label}
                action={action}
                testID={action.testID ?? (testID ? `${testID}-action-${index}` : undefined)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SidebarCalloutActionButton({
  action,
  testID,
}: {
  action: SidebarCalloutAction;
  testID?: string;
}) {
  const isPrimary = action.variant === "primary";
  const labelStyle = useMemo(
    () => [styles.actionLabel, isPrimary ? styles.actionLabelPrimary : styles.actionLabelSecondary],
    [isPrimary],
  );
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.actionButton,
      isPrimary ? styles.actionButtonPrimary : styles.actionButtonSecondary,
      pressed ? styles.actionButtonPressed : null,
      action.disabled ? styles.actionButtonDisabled : null,
    ],
    [action.disabled, isPrimary],
  );
  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      testID={testID}
      accessibilityRole="button"
      style={pressableStyle}
    >
      <Text style={labelStyle} numberOfLines={1}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    // Soft quiet chrome rule (--border-soft).
    borderTopColor: theme.colors.secondary,
    gap: theme.spacing[2],
  },
  containerError: {
    borderTopColor: theme.colors.destructive,
  },
  dismissButton: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    gap: theme.spacing[2],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  header: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    // Soft callout body: 12.5.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
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
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 10,
    borderWidth: theme.borderWidth[1],
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPrimary: {
    backgroundColor: theme.colors.foreground,
    borderColor: theme.colors.foreground,
  },
  actionButtonSecondary: {
    backgroundColor: "transparent",
    borderColor: theme.colors.border,
  },
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  actionLabelPrimary: {
    color: theme.colors.surface0,
  },
  actionLabelSecondary: {
    color: theme.colors.foreground,
  },
}));
