import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

interface ContextWindowMeterProps {
  maxTokens: number;
  usedTokens: number;
  totalCostUsd?: number | null;
}

const SVG_SIZE = 16;
const CENTER = SVG_SIZE / 2;
const RADIUS = 7;
const STROKE_WIDTH = 2.25;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const trackStrokeMapping = (theme: Theme) => ({
  stroke: theme.colors.surfaceWorkspace,
});

const progressMutedStrokeMapping = (theme: Theme) => ({
  stroke: theme.colors.foregroundMuted,
});

const progressAmberStrokeMapping = (theme: Theme) => ({
  stroke: theme.colors.palette.amber[500],
});

const progressDestructiveStrokeMapping = (theme: Theme) => ({
  stroke: theme.colors.destructive,
});

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function getProgressStrokeMapping(percentage: number): (theme: Theme) => { stroke: string } {
  if (percentage > 90) {
    return progressDestructiveStrokeMapping;
  }
  if (percentage >= 70) {
    return progressAmberStrokeMapping;
  }
  return progressMutedStrokeMapping;
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const percentage = getUsagePercentage(maxTokens, usedTokens);

  if (percentage === null) {
    return null;
  }

  const clampedPercentage = clampPercentage(percentage);
  const roundedPercentage = Math.round(percentage);
  const dashOffset = CIRCUMFERENCE - (clampedPercentage / 100) * CIRCUMFERENCE;
  const progressStrokeMapping = getProgressStrokeMapping(clampedPercentage);
  const trackStroke = trackStrokeMapping(theme).stroke;
  const progressStroke = progressStrokeMapping(theme).stroke;
  const formattedSessionCost =
    typeof totalCostUsd === "number" ? formatSessionCost(totalCostUsd) : null;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={styles.container}
          accessibilityRole="image"
          accessibilityLabel={t("contextWindow.accessibilityLabel", { percent: roundedPercentage })}
        >
          <Svg
            width={SVG_SIZE}
            height={SVG_SIZE}
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            style={styles.svg}
          >
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={trackStroke}
              strokeWidth={STROKE_WIDTH}
            />
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={progressStroke}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>{t("contextWindow.title")}</Text>
          <Text style={styles.tooltipText}>
            {t("contextWindow.usagePercent", { percent: roundedPercentage })}
          </Text>
          <Text style={styles.tooltipDetail}>
            {t("contextWindow.tokenCount", {
              used: formatTokenCount(usedTokens),
              max: formatTokenCount(maxTokens),
            })}
          </Text>
          {formattedSessionCost ? (
            <Text style={styles.tooltipDetail}>
              {t("contextWindow.sessionCost", { cost: formattedSessionCost })}
            </Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
  tooltipContent: {
    gap: theme.spacing[1],
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    // Soft meter chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
