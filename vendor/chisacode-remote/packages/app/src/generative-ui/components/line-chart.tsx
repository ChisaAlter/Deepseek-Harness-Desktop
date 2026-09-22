import React, { useMemo } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { GenerativeUiComponentBaseProps } from "@/generative-ui/registry/types";

interface LineChartDataPoint {
  [key: string]: unknown;
}

interface LineChartProps extends GenerativeUiComponentBaseProps {
  props: {
    title?: string;
    xAxis: string;
    yAxis: string;
    data: LineChartDataPoint[];
    height?: number;
    color?: string;
  };
}

/**
 * Generative UI line chart component.
 * Renders a simplified line chart using react-native primitives.
 */
export default function LineChart({ instanceId, props, sendAction }: LineChartProps) {
  const height = props.height ?? 300;
  const data = useMemo(() => props.data ?? [], [props.data]);
  const xKey = props.xAxis;
  const yKey = props.yAxis;
  const colorOverride = props.color;

  const numericData = useMemo(
    () =>
      data.map((d) => {
        const val = d[yKey];
        return typeof val === "string" ? Number.parseFloat(val) : (val as number);
      }),
    [data, yKey],
  );

  const max = useMemo(
    () => Math.max(...numericData.filter((n) => !Number.isNaN(n)), 0),
    [numericData],
  );

  const points = useMemo(
    () =>
      numericData.map((v, i) => {
        const safeV = Number.isNaN(v) ? 0 : v;
        const pointY = max > 0 ? ((max - safeV) / max) * 100 : 50;
        return {
          x: (i / Math.max(data.length - 1, 1)) * 100,
          y: pointY,
        };
      }),
    [numericData, max, data.length],
  );

  const chartContainerStyle = useMemo(() => ({ height, position: "relative" as const }), [height]);

  const pointPositionStyles = useMemo(
    () =>
      points.map((p) => ({
        left: `${p.x}%` as const,
        top: `${p.y}%` as const,
        ...(colorOverride ? { backgroundColor: colorOverride } : null),
      })),
    [points, colorOverride],
  );

  const pointHandlers = useMemo(
    () =>
      points.map((_, i) => () => {
        void sendAction(instanceId, "point_click", {
          index: i,
          point: data[i],
        });
      }),
    [points, instanceId, data, sendAction],
  );

  const labelKeys = useMemo(
    () => data.map((d) => `${String(d[xKey] ?? "")}-${String(d[yKey] ?? "")}`),
    [data, xKey, yKey],
  );

  if (data.length === 0) {
    return (
      <View style={styles.card}>
        {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
        <Text style={styles.empty}>No data</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
      <View style={chartContainerStyle}>
        <View style={styles.chartArea}>
          {points.map((p, i) => (
            <TouchableOpacity
              key={`point-${p.x}-${p.y}`}
              style={StyleSheet.compose(styles.dot, pointPositionStyles[i])}
              onPress={pointHandlers[i]}
            />
          ))}
          {points.length > 1 &&
            points
              .slice(1)
              .map((p) => <View key={`line-${p.x}-${p.y}`} style={styles.lineSegment} />)}
        </View>
        <View style={styles.labelsRow}>
          {data.map((d, i) => (
            <Text key={labelKeys[i]} style={styles.label} numberOfLines={1}>
              {String(d[xKey] ?? "")}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: 8,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  chartArea: {
    flex: 1,
    position: "relative",
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  dot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    marginTop: -6,
    backgroundColor: theme.colors.accent,
  },
  lineSegment: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  labelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
}));
