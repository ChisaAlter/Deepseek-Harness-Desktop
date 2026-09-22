import React, { useState, useMemo, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { GenerativeUiComponentBaseProps } from "@/generative-ui/registry/types";

interface ColumnDef {
  key: string;
  title: string;
  sortable?: boolean;
}

interface TableProps extends GenerativeUiComponentBaseProps {
  props: {
    title?: string;
    columns: ColumnDef[];
    rows: Array<Record<string, unknown>>;
    pageSize?: number;
  };
}

function getSortIndicator(sortKey: string | null, sortDir: string, colKey: string): string {
  if (sortKey !== colKey) return "";
  return sortDir === "asc" ? " △" : " ▽";
}

export default function DataTable({ instanceId, props, sendAction }: TableProps) {
  const pageSize = props.pageSize ?? 10;
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const columns = useMemo(() => props.columns ?? [], [props.columns]);
  const rows = useMemo(() => props.rows ?? [], [props.rows]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const va = String(a[sortKey] ?? "");
      const vb = String(b[sortKey] ?? "");
      const cmp = va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = useMemo(
    () => sortedRows.slice(page * pageSize, (page + 1) * pageSize),
    [sortedRows, page, pageSize],
  );

  const handleSort = useCallback(
    (key: string) => {
      setSortKey((prevSortKey) => {
        setSortDir((prevSortDir) => {
          const newDir = prevSortKey === key && prevSortDir === "asc" ? "desc" : "asc";
          void sendAction(instanceId, "sort", { column: key, direction: newDir });
          return newDir;
        });
        return key;
      });
    },
    [instanceId, sendAction],
  );

  const headerHandlers = useMemo(
    () =>
      columns.map((col) => () => {
        handleSort(col.key);
      }),
    [columns, handleSort],
  );

  const rowHandlers = useMemo(
    () =>
      pageRows.map((row, rowIdx) => () => {
        void sendAction(instanceId, "row_click", {
          index: page * pageSize + rowIdx,
          row,
        });
      }),
    [pageRows, page, pageSize, instanceId, sendAction],
  );

  const rowKeys = useMemo(
    () =>
      pageRows.map(
        (row, i) => `row-${page}-${i}-${columns.map((c) => String(row[c.key] ?? "")).join(",")}`,
      ),
    [pageRows, page, columns],
  );

  const handlePrevPage = useCallback(() => {
    setPage((p) => p - 1);
  }, []);
  const handleNextPage = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const isPrevDisabled = page === 0;
  const isNextDisabled = page >= totalPages - 1;

  return (
    <View style={styles.container}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}

      <ScrollView horizontal>
        <View>
          <View style={styles.headerRow}>
            {columns.map((col, i) => (
              <TouchableOpacity
                key={col.key}
                style={styles.cell}
                disabled={!col.sortable}
                onPress={headerHandlers[i]}
              >
                <Text style={styles.headerText}>
                  {col.title}
                  {getSortIndicator(sortKey, sortDir, col.key)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {pageRows.map((row, rowIdx) => (
            <TouchableOpacity
              key={rowKeys[rowIdx]}
              style={styles.dataRow}
              onPress={rowHandlers[rowIdx]}
            >
              {columns.map((col) => (
                <View key={col.key} style={styles.cell}>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {String(row[col.key] ?? "")}
                  </Text>
                </View>
              ))}
            </TouchableOpacity>
          ))}

          {pageRows.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No data</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {totalPages > 1 ? (
        <View style={styles.paginationRow}>
          <TouchableOpacity disabled={isPrevDisabled} onPress={handlePrevPage}>
            <Text style={isPrevDisabled ? styles.pageNavDisabled : styles.pageNavActive}>Prev</Text>
          </TouchableOpacity>
          <Text style={styles.pageCount}>
            {page + 1} / {totalPages}
          </Text>
          <TouchableOpacity disabled={isNextDisabled} onPress={handleNextPage}>
            <Text style={isNextDisabled ? styles.pageNavDisabled : styles.pageNavActive}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
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
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  headerText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundSubtleText,
  },
  cell: {
    padding: 8,
    minWidth: 100,
  },
  dataRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    // Soft quiet row rule (border-soft / secondary), not surface1 hover fill.
    borderBottomColor: theme.colors.secondary,
  },
  rowText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
  },
  emptyContainer: {
    padding: 16,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  paginationRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 8,
    gap: 8,
  },
  pageCount: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  pageNavActive: {
    color: theme.colors.accent,
    fontSize: 12.5,
    lineHeight: 16,
  },
  pageNavDisabled: {
    color: theme.colors.foregroundFaint,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
