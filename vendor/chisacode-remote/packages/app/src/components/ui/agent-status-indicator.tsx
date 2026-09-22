import React, { useEffect } from "react";
import { StyleSheet as RNStyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { AgentLifecycleStatus } from "@chisacode/protocol/agent-lifecycle";
import { AlertCircle, CheckCircle, ShieldAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";

export interface AgentStatusIndicatorProps {
  /** Agent lifecycle status */
  status: AgentLifecycleStatus;
  /** Whether the agent requires user attention */
  requiresAttention?: boolean;
  /** Reason for attention: "finished" | "error" | "permission" | null */
  attentionReason?: "finished" | "error" | "permission" | null;
  /** Number of pending permission requests */
  pendingPermissionCount?: number;
  /** Size variant: "sm" for sidebar rows, "md" for full list */
  size?: "sm" | "md";
}

const ThemedCheckCircle = withUnistyles(CheckCircle);
const ThemedAlertCircle = withUnistyles(AlertCircle);
const ThemedShieldAlert = withUnistyles(ShieldAlert);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const successColorMapping = (theme: Theme) => ({
  color: theme.colors.statusSuccess,
});
const dangerColorMapping = (theme: Theme) => ({
  color: theme.colors.statusDanger,
});
const warningColorMapping = (theme: Theme) => ({
  color: theme.colors.statusWarning,
});
const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});

/**
 * Compact visual indicator for agent status.
 *
 * - `running`: pulsing accent dot
 * - `initializing`: spinning indicator
 * - `error`: static red dot (+ attention reason icon for md)
 * - `requiresAttention` / `pendingPermissionCount > 0`: amber dot with optional count
 * - `idle` / `closed`: renders nothing
 */
export function AgentStatusIndicator({
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount = 0,
  size = "sm",
}: AgentStatusIndicatorProps) {
  const { t } = useTranslation();
  const needsAttention = requiresAttention || pendingPermissionCount > 0;
  const isRunning = status === "running";
  const isInitializing = status === "initializing";
  const isError = status === "error";
  const isSm = size === "sm";
  const warningDotStyle = isSm ? styles.warningDotSm : styles.warningDotMd;
  const dangerDotStyle = isSm ? styles.dangerDotSm : styles.dangerDotMd;

  // Hide indicator for idle/closed - nothing visual to show.
  if (status === "idle" || status === "closed") {
    if (!requiresAttention && pendingPermissionCount === 0) {
      return null;
    }
  }

  // --- Running: pulsing accent dot ---
  if (isRunning) {
    return <PulsingDot size={isSm ? 6 : 8} />;
  }

  // --- Initializing: spinner ---
  if (isInitializing) {
    return <ThemedLoadingSpinner uniProps={accentColorMapping} size={isSm ? "small" : undefined} />;
  }

  // --- Attention badge for finished/error/permission (md only) ---
  if (size === "md" && attentionReason) {
    const badge = renderAttentionBadge(attentionReason, t);
    if (badge) return badge;
  }

  // --- Permission count badge ---
  if (pendingPermissionCount > 0) {
    return (
      <View style={styles.permissionWrapper}>
        <View style={warningDotStyle} />
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{pendingPermissionCount}</Text>
        </View>
      </View>
    );
  }

  // --- Error: static red dot ---
  if (isError) {
    return <View style={dangerDotStyle} />;
  }

  // --- Generic attention (no specific reason) ---
  if (needsAttention) {
    return <View style={warningDotStyle} />;
  }

  return null;
}

function renderAttentionBadge(
  attentionReason: "finished" | "error" | "permission",
  t: (key: string) => string,
) {
  if (attentionReason === "finished") {
    return (
      <View style={styles.attentionBadge}>
        <ThemedCheckCircle size={14} uniProps={successColorMapping} />
        <Text style={styles.successText}>{t("agentStatus.completed")}</Text>
      </View>
    );
  }
  if (attentionReason === "error") {
    return (
      <View style={styles.attentionBadge}>
        <ThemedAlertCircle size={14} uniProps={dangerColorMapping} />
        <Text style={styles.dangerText}>{t("agentStatus.errored")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.attentionBadge}>
      <ThemedShieldAlert size={14} uniProps={warningColorMapping} />
      <Text style={styles.warningText}>{t("agentStatus.needsPermission")}</Text>
    </View>
  );
}

/** Pulsing dot animation for "running" status */
function PulsingDot({ size }: { size: number }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 500, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1, // infinite repeat
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const outerStyle = React.useMemo(
    () => [staticStyles.dot, { width: size, height: size } satisfies ViewStyle, animatedStyle],
    [animatedStyle, size],
  );

  // Theme fill on a plain View so Reanimated never receives Unistyles styles.
  return (
    <Animated.View style={outerStyle}>
      <View style={styles.accentFill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  permissionWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countBadge: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    backgroundColor: theme.colors.statusWarningBg,
  },
  countText: {
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
    color: theme.colors.statusWarning,
  },
  attentionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  attentionText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
  },
  successText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
    color: theme.colors.statusSuccess,
  },
  dangerText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
    color: theme.colors.statusDanger,
  },
  warningText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
    color: theme.colors.statusWarning,
  },
  warningDotSm: {
    width: 6,
    height: 6,
    borderRadius: 9999,
    backgroundColor: theme.colors.statusWarning,
  },
  warningDotMd: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: theme.colors.statusWarning,
  },
  dangerDotSm: {
    width: 6,
    height: 6,
    borderRadius: 9999,
    backgroundColor: theme.colors.statusDanger,
  },
  dangerDotMd: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: theme.colors.statusDanger,
  },
  accentFill: {
    ...RNStyleSheet.absoluteFill,
    borderRadius: 9999,
    backgroundColor: theme.colors.accent,
  },
}));

const staticStyles = RNStyleSheet.create({
  dot: {
    borderRadius: 9999,
    overflow: "hidden",
  },
});
