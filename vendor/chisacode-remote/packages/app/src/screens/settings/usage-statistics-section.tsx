import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Circle } from "react-native-svg";
import { Download, RefreshCw, Trash2 } from "lucide-react-native";
import type { UsageSummaryPayload } from "@chisacode/protocol/messages";
import { StyleSheet } from "react-native-unistyles";
import { baseColors } from "@/styles/theme";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-context";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { downloadTextFile } from "@/utils/download-text-file";
import {
  buildHeatmapCells,
  buildModelUsageSegments,
  buildTrendBars,
  formatTokenCount,
  type UsageHeatmapCell,
  type UsageModelSegment,
  type UsageTrendBar,
  type UsageTrendSegment,
} from "./usage-statistics-model";

const RANGE_OPTIONS = [7, 30, 180] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];
type ExportFormat = "json" | "csv";
type UsageTab = "local" | "provider";

/** Tab option values; labels are resolved via i18n at render time. */
const TAB_OPTIONS: ReadonlyArray<{ value: UsageTab; label: string }> = [
  { value: "local", label: "" },
  { value: "provider", label: "" },
];

/** Chart color palette — uses theme tokens where palette equivalents exist; hardcodes otherwise. */
const CHART_COLOR_KEYS = [
  "blue600",
  "green600",
  "amber500",
  "red600",
  "violet700", // No palette equivalent — closest purple tokens differ significantly
  "cyan600", // No palette equivalent
  "pink600", // No palette equivalent
  "slate500", // No palette equivalent — palette gray/zinc differ noticeably
] as const;

interface UsageStatisticsSectionProps {
  serverId: string | null;
}

export function UsageStatisticsSection({ serverId }: UsageStatisticsSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const [rangeDays, setRangeDays] = useState<RangeOption>(30);
  const [summary, setSummary] = useState<UsageSummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [activeTab, setActiveTab] = useState<UsageTab>("local");

  const rangeOptions = useMemo(
    () =>
      RANGE_OPTIONS.map((value) => ({
        value: String(value),
        label: t(`settings.usage.range.${value}`),
      })),
    [t],
  );

  const loadSummary = useCallback(async () => {
    if (!serverId || !client || !isConnected) {
      setSummary(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await client.fetchUsageSummary({ rangeDays });
      setSummary(payload.summary);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(t("settings.usage.loadFailed", { message }));
    } finally {
      setIsLoading(false);
    }
  }, [client, isConnected, rangeDays, serverId, t]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleRangeChange = useCallback((value: string) => {
    const parsed = Number(value);
    if (parsed === 7 || parsed === 30 || parsed === 180) {
      setRangeDays(parsed);
    }
  }, []);
  const rangeControl = useMemo(
    () => (
      <SegmentedControl
        size="sm"
        value={String(rangeDays)}
        onValueChange={handleRangeChange}
        options={rangeOptions}
        testID="settings-usage-range"
      />
    ),
    [handleRangeChange, rangeDays, rangeOptions],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!client || isExporting) {
        return;
      }
      setIsExporting(true);
      setError(null);
      try {
        const payload = await client.exportUsage({ format });
        const shared = await exportUsagePayload(payload.filename, payload.content, format);
        if (!shared && !isWeb) {
          toast.show(t("settings.usage.shareUnavailable"), { variant: "error" });
        }
      } catch (exportError) {
        const message = exportError instanceof Error ? exportError.message : String(exportError);
        setError(t("settings.usage.exportFailed", { message }));
      } finally {
        setIsExporting(false);
      }
    },
    [client, isExporting, toast, t],
  );

  const handleExportJson = useCallback(() => {
    void handleExport("json");
  }, [handleExport]);

  const handleExportCsv = useCallback(() => {
    void handleExport("csv");
  }, [handleExport]);

  const handleClear = useCallback(async () => {
    if (!client || isClearing) {
      return;
    }
    const confirmed = await confirmDialog({
      title: t("settings.usage.clearConfirmTitle"),
      message: t("settings.usage.clearConfirmMessage"),
      confirmLabel: t("settings.usage.clear"),
      cancelLabel: t("settings.back"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setIsClearing(true);
    setError(null);
    try {
      await client.clearUsage();
      await loadSummary();
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : String(clearError);
      setError(t("settings.usage.clearFailed", { message }));
    } finally {
      setIsClearing(false);
    }
  }, [client, isClearing, loadSummary, t]);

  const canQuery = Boolean(serverId && client && isConnected);

  const handleTabChange = useCallback((value: string) => {
    if (value === "local" || value === "provider") {
      setActiveTab(value);
    }
  }, []);

  const tabOptions = useMemo(
    () =>
      TAB_OPTIONS.map((opt) =>
        Object.assign({}, opt, { label: t(`settings.usage.tab.${opt.value}`) }),
      ),
    [t],
  );

  return (
    <SettingsSection
      title={t("settings.usage.title")}
      trailing={rangeControl}
      testID="settings-usage-section"
    >
      {!canQuery ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>{t("settings.usage.noLocalDaemon")}</Text>
        </View>
      ) : (
        <>
          <SegmentedControl
            size="sm"
            value={activeTab}
            onValueChange={handleTabChange}
            options={tabOptions}
            testID="settings-usage-tab"
          />
          {activeTab === "local" ? (
            <>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <UsageMetricGrid summary={summary} isLoading={isLoading} />
              <UsageHeatmap summary={summary} />
              <UsageTrendChart summary={summary} />
              <UsageModelChart summary={summary} />
              <View style={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={RefreshCw}
                  onPress={loadSummary}
                  loading={isLoading}
                  testID="settings-usage-refresh"
                >
                  {t("settings.usage.refresh")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={Download}
                  onPress={handleExportJson}
                  loading={isExporting}
                  testID="settings-usage-export-json"
                >
                  {t("settings.usage.exportJson")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={Download}
                  onPress={handleExportCsv}
                  loading={isExporting}
                  testID="settings-usage-export-csv"
                >
                  {t("settings.usage.exportCsv")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  leftIcon={Trash2}
                  onPress={handleClear}
                  loading={isClearing}
                  testID="settings-usage-clear"
                >
                  {t("settings.usage.clear")}
                </Button>
              </View>
              {summary?.generatedAt ? (
                <Text style={styles.updatedAt}>
                  {t("settings.usage.updatedAt", {
                    time: new Date(summary.generatedAt).toLocaleString(),
                  })}
                </Text>
              ) : null}
            </>
          ) : (
            <ProviderUsageView />
          )}
        </>
      )}
    </SettingsSection>
  );
}

function ProviderUsageView() {
  const { t } = useTranslation();

  return (
    <View style={providerUsageStyles.placeholder}>
      <Text style={providerUsageStyles.title}>{t("settings.usage.providerComingSoon")}</Text>
      <Text style={providerUsageStyles.hint}>{t("settings.usage.providerHint")}</Text>
    </View>
  );
}

function UsageMetricGrid({
  summary,
  isLoading,
}: {
  summary: UsageSummaryPayload | null;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const metrics = useMemo(
    () => [
      {
        label: t("settings.usage.metrics.tokens"),
        value: summary ? formatTokenCount(summary.totals.totalTokens) : "0",
        hint: summary
          ? t("settings.usage.metrics.tokenBreakdown", {
              input: formatTokenCount(summary.totals.inputTokens),
              output: formatTokenCount(summary.totals.outputTokens),
            })
          : t("settings.usage.metrics.noData"),
      },
      {
        label: t("settings.usage.metrics.turns"),
        value: String(summary?.totals.turnCount ?? 0),
        hint: t("settings.usage.metrics.messagesHint", {
          count: summary?.totals.messageCount ?? 0,
        }),
      },
      {
        label: t("settings.usage.metrics.messages"),
        value: String(summary?.totals.messageCount ?? 0),
        hint: t("settings.usage.metrics.localOnly"),
      },
      {
        label: t("settings.usage.metrics.activeDays"),
        value: String(summary?.totals.activeDays ?? 0),
        hint: t("settings.usage.metrics.rangeDays", { count: summary?.rangeDays ?? 30 }),
      },
      {
        label: t("settings.usage.metrics.streak"),
        value: String(summary?.totals.currentStreakDays ?? 0),
        hint: t("settings.usage.metrics.currentStreak"),
      },
      {
        label: t("settings.usage.metrics.topModel"),
        value: summary?.mostUsedModel?.model ?? "-",
        hint: summary?.mostUsedModel
          ? t("settings.usage.metrics.topModelHint", {
              share: summary.mostUsedModel.percentage,
              turns: summary.mostUsedModel.turnCount,
            })
          : t("settings.usage.metrics.noData"),
      },
    ],
    [summary, t],
  );

  return (
    <View style={styles.metricGrid} testID="settings-usage-metrics">
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.metricCard}>
          <Text style={styles.metricLabel}>{metric.label}</Text>
          <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
            {isLoading && !summary ? "..." : metric.value}
          </Text>
          <Text style={styles.metricHint} numberOfLines={2}>
            {metric.hint}
          </Text>
        </View>
      ))}
    </View>
  );
}

function UsageHeatmap({ summary }: { summary: UsageSummaryPayload | null }) {
  const { t } = useTranslation();
  const cells = useMemo(() => (summary ? buildHeatmapCells(summary) : []), [summary]);
  const weeks = useMemo(() => groupIntoWeeks(cells), [cells]);
  return (
    <ChartPanel title={t("settings.usage.heatmap.title")} testID="settings-usage-heatmap">
      <View style={styles.heatmapGrid}>
        {weeks.map((week) => (
          <View key={week[0]?.date ?? "empty-week"} style={styles.heatmapWeek}>
            {week.map((cell) => (
              <TooltipTarget key={cell.date} tooltip={cell.tooltip}>
                <HeatmapCell level={cell.level} />
              </TooltipTarget>
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.chartHint}>{t("settings.usage.heatmap.hint")}</Text>
    </ChartPanel>
  );
}

function HeatmapCell({ level }: { level: number }) {
  const cellStyle = useMemo(() => [styles.heatmapCell, heatmapLevelStyle(level)], [level]);
  return <View style={cellStyle} />;
}

function UsageTrendChart({ summary }: { summary: UsageSummaryPayload | null }) {
  const { t } = useTranslation();
  const bars = useMemo(() => (summary ? buildTrendBars(summary) : []), [summary]);
  const maxTokens = Math.max(...bars.map((bar) => bar.totalTokens), 0);
  return (
    <ChartPanel title={t("settings.usage.trend.title")} testID="settings-usage-trend">
      <View style={styles.trendChart}>
        {bars.map((bar) => (
          <TrendBar key={bar.date} bar={bar} maxTokens={maxTokens} />
        ))}
      </View>
      <Text style={styles.chartHint}>{t("settings.usage.trend.hint")}</Text>
    </ChartPanel>
  );
}

function TrendBar({ bar, maxTokens }: { bar: UsageTrendBar; maxTokens: number }) {
  const height = maxTokens > 0 ? Math.max(8, Math.round((bar.totalTokens / maxTokens) * 132)) : 2;
  const stackStyle = useMemo(() => [styles.trendBarStack, { height }], [height]);
  const emptyStyle = useMemo(() => [styles.trendBarSegment, styles.trendBarEmpty], []);
  return (
    <TooltipTarget tooltip={bar.tooltip} containerStyle={styles.trendBarTarget}>
      <View style={styles.trendBarShell}>
        <View style={stackStyle}>
          {bar.segments.length > 0 ? (
            bar.segments.map((segment) => <TrendBarSegment key={segment.model} segment={segment} />)
          ) : (
            <View style={emptyStyle} />
          )}
        </View>
      </View>
    </TooltipTarget>
  );
}

function TrendBarSegment({ segment }: { segment: UsageTrendSegment }) {
  const segmentStyle = useMemo(
    () => [
      styles.trendBarSegment,
      {
        flexGrow: Math.max(segment.totalTokens, 1),
        backgroundColor: chartColor(segment.colorIndex),
      },
    ],
    [segment.colorIndex, segment.totalTokens],
  );
  return <View style={segmentStyle} />;
}

function UsageModelChart({ summary }: { summary: UsageSummaryPayload | null }) {
  const { t } = useTranslation();
  const segments = useMemo(() => (summary ? buildModelUsageSegments(summary) : []), [summary]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const activeSegment = segments.find((segment) => segment.model === activeModel) ?? segments[0];

  useEffect(() => {
    if (!activeModel && segments[0]) {
      setActiveModel(segments[0].model);
    }
    if (activeModel && !segments.some((segment) => segment.model === activeModel)) {
      setActiveModel(segments[0]?.model ?? null);
    }
  }, [activeModel, segments]);

  return (
    <ChartPanel title={t("settings.usage.models.title")} testID="settings-usage-models">
      <View style={styles.modelChartLayout}>
        <View style={styles.donutWrap}>
          <ModelDonut segments={segments} activeModel={activeSegment?.model ?? null} />
          <View style={styles.donutCenter}>
            <Text style={styles.donutValue}>
              {activeSegment ? `${activeSegment.percentage}%` : "0%"}
            </Text>
            <Text style={styles.donutLabel} numberOfLines={1}>
              {activeSegment?.model ?? t("settings.usage.models.empty")}
            </Text>
          </View>
        </View>
        <View style={styles.modelList}>
          {segments.length === 0 ? (
            <Text style={styles.emptyText}>{t("settings.usage.empty")}</Text>
          ) : (
            segments.map((segment) => (
              <ModelRow
                key={segment.model}
                segment={segment}
                active={segment.model === activeSegment?.model}
                onActivate={setActiveModel}
              />
            ))
          )}
        </View>
      </View>
    </ChartPanel>
  );
}

function ModelDonut({
  segments,
  activeModel,
}: {
  segments: UsageModelSegment[];
  activeModel: string | null;
}) {
  const size = 148;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#00000018"
        strokeWidth={strokeWidth}
        fill="none"
      />
      {segments.map((segment) => {
        const length = (segment.percentage / 100) * circumference;
        const dashArray = `${Math.max(length, 1)} ${circumference}`;
        const dashOffset = -offset;
        offset += length;
        return (
          <Circle
            key={segment.model}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={chartColor(segment.colorIndex)}
            strokeWidth={segment.model === activeModel ? strokeWidth + 4 : strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            fill="none"
            rotation="-90"
            originX={size / 2}
            originY={size / 2}
          />
        );
      })}
    </Svg>
  );
}

function ModelRow({
  segment,
  active,
  onActivate,
}: {
  segment: UsageModelSegment;
  active: boolean;
  onActivate: (model: string) => void;
}) {
  const handleActivate = useCallback(() => onActivate(segment.model), [onActivate, segment.model]);
  const rowStyle = useMemo(
    () => [styles.modelRow, active ? styles.modelRowActive : null],
    [active],
  );
  const swatchStyle = useMemo(
    () => [styles.modelSwatch, { backgroundColor: chartColor(segment.colorIndex) }],
    [segment.colorIndex],
  );
  return (
    <TooltipTarget tooltip={segment.tooltip} onShow={handleActivate}>
      <View style={rowStyle}>
        <View style={swatchStyle} />
        <View style={styles.modelRowText}>
          <Text style={styles.modelName} numberOfLines={1}>
            {segment.model}
          </Text>
          <Text style={styles.modelMeta} numberOfLines={1}>
            {formatTokenCount(segment.totalTokens)} · {segment.turnCount} turns
          </Text>
        </View>
        <Text style={styles.modelPercent}>{segment.percentage}%</Text>
      </View>
    </TooltipTarget>
  );
}

function ChartPanel({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.chartPanel} testID={testID}>
      <Text style={styles.chartTitle}>{title}</Text>
      {children}
    </View>
  );
}

function TooltipTarget({
  tooltip,
  children,
  containerStyle,
  onShow,
}: {
  tooltip: string;
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  onShow?: () => void;
}) {
  const isCompact = useIsCompactFormFactor();
  const [visible, setVisible] = useState(false);
  const lines = useMemo(() => tooltip.split("\n").filter(Boolean), [tooltip]);

  const show = useCallback(() => {
    onShow?.();
    setVisible(true);
  }, [onShow]);
  const hide = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => {
    onShow?.();
    setVisible((current) => !current);
  }, [onShow]);
  const targetStyle = useMemo(() => [styles.tooltipTarget, containerStyle], [containerStyle]);

  return (
    <View style={targetStyle} onPointerEnter={show} onPointerLeave={hide}>
      <Pressable
        onPress={isCompact ? toggle : show}
        onLongPress={show}
        style={styles.tooltipPressable}
      >
        {children}
      </Pressable>
      {visible ? (
        <View style={styles.tooltipBubble} pointerEvents="none" testID="settings-usage-tooltip">
          {lines.map((line, index) => (
            <Text key={line} style={index === 0 ? styles.tooltipTitle : styles.tooltipText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function groupIntoWeeks(cells: UsageHeatmapCell[]): UsageHeatmapCell[][] {
  const weeks: UsageHeatmapCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function chartColor(index: number): string {
  const key = CHART_COLOR_KEYS[index % CHART_COLOR_KEYS.length];
  switch (key) {
    case "blue600":
      return baseColors.blue[600];
    case "green600":
      return baseColors.green[600];
    case "amber500":
      return baseColors.amber[500];
    case "red600":
      return baseColors.red[600];
    // Hardcoded — no close palette equivalent exists
    case "violet700":
      return "#7c3aed";
    case "cyan600":
      return "#0891b2";
    case "pink600":
      return "#db2777";
    case "slate500":
      return "#64748b";
  }
}

function heatmapLevelStyle(level: number): ViewStyle {
  if (level === 1) return styles.heatmapLevel1;
  if (level === 2) return styles.heatmapLevel2;
  if (level === 3) return styles.heatmapLevel3;
  if (level === 4) return styles.heatmapLevel4;
  return styles.heatmapLevel0;
}

function exportUsagePayload(
  filename: string,
  content: string,
  format: ExportFormat,
): Promise<boolean> {
  const mimeType = format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
  return downloadTextFile(filename, content, mimeType);
}

const styles = StyleSheet.create((theme) => ({
  placeholder: {
    padding: theme.spacing[6],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  errorText: {
    color: theme.colors.palette.red[500],
    fontSize: 12.5,
    lineHeight: 16,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  metricCard: {
    minWidth: 188,
    flexGrow: 1,
    flexBasis: "30%",
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
  },
  metricLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  // Soft metric figure: quieter than display xl.
  metricValue: {
    marginTop: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: theme.fontWeight.semibold,
  },
  metricHint: {
    minHeight: 32,
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  chartPanel: {
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    overflow: "visible",
  },
  // Soft chart title: near sheet scale medium.
  chartTitle: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    marginBottom: theme.spacing[4],
  },
  chartHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[3],
  },
  heatmapGrid: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    minHeight: 118,
  },
  heatmapWeek: {
    gap: 5,
  },
  heatmapCell: {
    width: 13,
    height: 13,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heatmapLevel0: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  heatmapLevel1: {
    backgroundColor: theme.colors.palette.blue[200],
  },
  heatmapLevel2: {
    backgroundColor: theme.colors.palette.blue[400],
  },
  heatmapLevel3: {
    backgroundColor: theme.colors.palette.blue[600],
  },
  heatmapLevel4: {
    backgroundColor: theme.colors.palette.blue[900],
  },
  trendChart: {
    minHeight: 150,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },
  trendBarTarget: {
    flex: 1,
    minWidth: 7,
  },
  trendBarShell: {
    height: 140,
    justifyContent: "flex-end",
  },
  trendBarStack: {
    width: "100%",
    minHeight: 2,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  trendBarSegment: {
    width: "100%",
    minHeight: 1,
  },
  trendBarEmpty: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  modelChartLayout: {
    flexDirection: "row",
    gap: theme.spacing[6],
    alignItems: "center",
    flexWrap: "wrap",
  },
  donutWrap: {
    width: 168,
    height: 168,
    alignItems: "center",
    justifyContent: "center",
  },
  donutCenter: {
    position: "absolute",
    width: 96,
    alignItems: "center",
  },
  // Soft donut center figure.
  donutValue: {
    color: theme.colors.foreground,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: theme.fontWeight.semibold,
  },
  donutLabel: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    maxWidth: 92,
  },
  modelList: {
    flex: 1,
    minWidth: 240,
    gap: theme.spacing[2],
  },
  // Soft model chip: r10 set-item family.
  modelRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surface0,
  },
  modelRowActive: {
    // Soft selected model chip: elevated surface0 + accent edge, not surface1 wash.
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface0,
  },
  modelSwatch: {
    width: 10,
    height: 28,
    borderRadius: 5,
  },
  modelRowText: {
    flex: 1,
    minWidth: 0,
  },
  modelName: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  modelMeta: {
    marginTop: 2,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  modelPercent: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.semibold,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  tooltipTarget: {
    position: "relative",
    overflow: "visible",
  },
  tooltipPressable: {
    minHeight: 1,
    minWidth: 1,
  },
  // Soft quiet tooltip bubble.
  tooltipBubble: {
    position: "absolute",
    left: 0,
    bottom: "100%",
    zIndex: 30,
    minWidth: 176,
    maxWidth: 260,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  updatedAt: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));

const providerUsageStyles = StyleSheet.create((theme) => ({
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.semibold,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
}));
