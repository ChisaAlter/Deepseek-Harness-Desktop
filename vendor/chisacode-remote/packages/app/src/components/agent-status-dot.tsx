import { useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@chisacode/protocol/agent-lifecycle";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

export function AgentStatusDot({
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount,
  showInactive = false,
}: {
  status: string | null | undefined;
  requiresAttention: boolean | null | undefined;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  showInactive?: boolean;
}) {
  const { t } = useTranslation();

  if (!status) {
    return null;
  }
  if (!isAgentLifecycleStatus(status)) {
    return null;
  }

  const bucket = deriveSidebarStateBucket({
    status,
    requiresAttention: Boolean(requiresAttention),
    attentionReason: attentionReason ?? null,
    pendingPermissionCount: pendingPermissionCount ?? 0,
  });
  const colorStyle = getStatusDotColorStyle(bucket, showInactive);

  if (!colorStyle) {
    return null;
  }

  return (
    <AgentStatusDotView colorStyle={colorStyle} accessibilityLabel={labelForBucket(bucket, t)} />
  );
}

function labelForBucket(
  bucket: ReturnType<typeof deriveSidebarStateBucket>,
  t: (key: string) => string,
): string {
  switch (bucket) {
    case "done":
      return t("agentStatus.completed");
    case "failed":
      return t("agentStatus.errored");
    case "needs_input":
      return t("agentStatus.needsPermission");
    case "running":
      return t("agentStatus.running");
    case "attention":
      return t("agentStatus.idle");
  }
}

function AgentStatusDotView({
  colorStyle,
  accessibilityLabel,
}: {
  colorStyle: ViewStyle;
  accessibilityLabel: string;
}) {
  const dotStyle = useMemo(() => [styles.dot, colorStyle], [colorStyle]);
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="image" style={dotStyle} />
  );
}

function isAgentLifecycleStatus(value: string): value is AgentLifecycleStatus {
  return AGENT_LIFECYCLE_STATUSES.some((status) => status === value);
}

function getStatusDotColorStyle(
  bucket: ReturnType<typeof deriveSidebarStateBucket>,
  showDoneAsInactive: boolean,
): ViewStyle | null {
  switch (bucket) {
    case "needs_input":
      return styles.dotNeedsInput;
    case "failed":
      return styles.dotFailed;
    case "running":
      return styles.dotRunning;
    case "attention":
      return styles.dotAttention;
    case "done":
      return showDoneAsInactive ? styles.dotInactive : null;
  }
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  // Status colors mirror getStatusDotColor() so theme updates stay on the StyleSheet path.
  dotNeedsInput: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  dotFailed: {
    backgroundColor: theme.colors.palette.red[500],
  },
  dotRunning: {
    backgroundColor: theme.colors.palette.blue[500],
  },
  dotAttention: {
    backgroundColor: theme.colors.palette.green[500],
  },
  dotInactive: {
    backgroundColor: theme.colors.border,
  },
}));
