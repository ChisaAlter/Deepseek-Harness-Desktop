import type { ReactElement, RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Text,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { Theme } from "@/styles/theme";

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const activityIndicatorColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/** Header/body row model used by the diff pane virtualized list. */
export type DiffPaneFlatItem =
  | { type: "header"; file: ParsedDiffFile; fileIndex: number; isExpanded: boolean }
  | { type: "body"; file: ParsedDiffFile; fileIndex: number };

/** Layout getter contract for the mixed-height diff pane list. */
export type DiffPaneFlatItemLayoutGetter = NonNullable<
  FlatListProps<DiffPaneFlatItem>["getItemLayout"]
>;

interface DiffPaneBodyProps {
  isStatusLoading: boolean;
  statusErrorMessage: string | null;
  notGit: boolean;
  isDiffLoading: boolean;
  diffErrorMessage: string | null;
  hasChanges: boolean;
  emptyMessage: string;
  flatItems: DiffPaneFlatItem[];
  stickyHeaderIndices: number[];
  renderFlatItem: ({ item }: { item: DiffPaneFlatItem }) => ReactElement;
  flatKeyExtractor: (item: DiffPaneFlatItem) => string;
  getFlatItemLayout: DiffPaneFlatItemLayoutGetter;
  flatExtraData: unknown;
  diffListRef: RefObject<FlatList<DiffPaneFlatItem> | null>;
  handleDiffListLayout: (event: LayoutChangeEvent) => void;
  handleDiffListScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  showDesktopWebScrollbar: boolean;
}

/** Renders loading, error, empty, and virtualized diff-list states. */
export function DiffPaneBody({
  isStatusLoading,
  statusErrorMessage,
  notGit,
  isDiffLoading,
  diffErrorMessage,
  hasChanges,
  emptyMessage,
  flatItems,
  stickyHeaderIndices,
  renderFlatItem,
  flatKeyExtractor,
  getFlatItemLayout,
  flatExtraData,
  diffListRef,
  handleDiffListLayout,
  handleDiffListScroll,
  onContentSizeChange,
  showDesktopWebScrollbar,
}: DiffPaneBodyProps) {
  const { t } = useTranslation();
  if (isStatusLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedActivityIndicator size="large" uniProps={activityIndicatorColorMapping} />
        <Text style={styles.loadingText}>{t("git.checkingRepository")}</Text>
      </View>
    );
  }
  if (statusErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );
  }
  if (notGit) {
    return (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>{t("git.notGitRepository")}</Text>
      </View>
    );
  }
  if (isDiffLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedActivityIndicator size="large" uniProps={activityIndicatorColorMapping} />
      </View>
    );
  }
  if (diffErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
      </View>
    );
  }
  if (!hasChanges) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }
  return (
    <FlatList
      ref={diffListRef}
      data={flatItems}
      renderItem={renderFlatItem}
      keyExtractor={flatKeyExtractor}
      getItemLayout={getFlatItemLayout}
      stickyHeaderIndices={stickyHeaderIndices}
      extraData={flatExtraData}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      testID="git-diff-scroll"
      onLayout={handleDiffListLayout}
      onScroll={handleDiffListScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={!showDesktopWebScrollbar}
      removeClippedSubviews={false}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={10}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: theme.spacing[8],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[4],
  },
  loadingText: {
    fontSize: 14.5,
    lineHeight: 20,
    color: theme.colors.foregroundMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  errorText: {
    fontSize: 14.5,
    lineHeight: 20,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
  },
  // Soft empty state: body-adjacent muted copy.
  emptyText: {
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foregroundMuted,
  },
}));
