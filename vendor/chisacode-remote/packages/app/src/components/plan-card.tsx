import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/markdown";

/**
 * Plan card chrome around the shared MarkdownRenderer.
 * No local markdown rule reimplementation — lists/paragraphs/code come from the shared core.
 */
export function PlanCard({
  title,
  description,
  text,
  footer,
  disableOuterSpacing = false,
  testID,
}: {
  title?: string;
  description?: string;
  text: string;
  footer?: ReactNode;
  disableOuterSpacing?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();

  const containerStyle = useMemo(
    () => [styles.container, disableOuterSpacing && styles.containerCompact],
    [disableOuterSpacing],
  );

  return (
    <View testID={testID} style={containerStyle}>
      <Text style={styles.title}>{title ?? t("plan.title")}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <MarkdownRenderer text={text} compact enableHtmlish={false} />
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .card: elevated surface0, 14px radius, quiet border.
  container: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: 14,
    borderWidth: 1,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
  },
  containerCompact: {
    marginVertical: 0,
  },
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  description: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  footer: {
    gap: theme.spacing[2],
  },
}));
