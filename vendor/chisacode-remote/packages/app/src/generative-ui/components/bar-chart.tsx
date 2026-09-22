import React, { useMemo } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { GenerativeUiComponentBaseProps } from "@/generative-ui/registry/types";

interface BarChartDataPoint {
  [key: string]: unknown;
}

interface BarChartProps extends GenerativeUiComponentBaseProps {
  props: {
    title?: string;
    label: string;
    value: string;
    data: BarChartDataPoint[];
    height?: number;
  };
}

export default function BarChart({ instanceId, props, sendAction }: BarChartProps) {
  const height = props.height ?? 280;
  const data = useMemo(() => props.data ?? [], [props.data]);
  const labelKey = props.label;
  const valueKey = props.value;

  const numericData = useMemo(
    () =>
      data.map((d) => {
        const val = d[valueKey];
        return typeof val === "string" ? Number.parseFloat(val) : (val as number);
      }),
    [data, valueKey],
  );

  const max = useMemo(
    () => Math.max(...numericData.filter((n) => !Number.isNaN(n)), 0),
    [numericData],
  );

  const barContainerStyle = useMemo(
    () => ({
      height,
      flexDirection: "row" as const,
      alignItems: "flex-end" as const,
      gap: 8,
    }),
    [height],
  );

  const barHeightStyles = useMemo(
    () =>
      numericData.map((val) => {
        const safeVal = Number.isNaN(val) ? 0 : val;
        const barH = max > 0 ? (safeVal / max) * (height - 30) : 0;
        return {
          height: barH,
        };
      }),
    [numericData, max, height],
  );

  const barHandlers = useMemo(
    () =>
      data.map((d, i) => () => {
        void sendAction(instanceId, "bar_click", {
          index: i,
          category: d,
        });
      }),
    [data, instanceId, sendAction],
  );

  const barKeys = useMemo(
    () => data.map((d) => `${String(d[labelKey] ?? "")}-${String(d[valueKey] ?? "")}`),
    [data, labelKey, valueKey],
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
      <View style={barContainerStyle}>
        {data.map((d, i) => {
          const val = numericData[i];
          return (
            <View key={barKeys[i]} style={styles.barItem}>
              <Text style={styles.barValue}>{String(val ?? "")}</Text>
              <TouchableOpacity
                style={StyleSheet.compose(styles.bar, barHeightStyles[i])}
                onPress={barHandlers[i]}
              />
              <Text style={styles.barLabel} numberOfLines={1}>
                {String(d[labelKey] ?? "")}
              </Text>
            </View>
          );
        })}
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
  barValue: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
    marginBottom: 2,
  },
  barLabel: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
    textAlign: "center",
  },
  barItem: {
    flex: 1,
    alignItems: "center",
  },
  bar: {
    width: "100%",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.base,
    minHeight: 2,
  },
}));
