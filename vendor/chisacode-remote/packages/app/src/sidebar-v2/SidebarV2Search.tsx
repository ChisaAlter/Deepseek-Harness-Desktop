import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Search as SearchIcon, SquarePen, X } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { useTranslation } from "react-i18next";
import { useSidebarV2Store } from "./store";
import { searchSidebarThreadsByTitle } from "./logic";
import type { SidebarV2Thread } from "./agent-adapter";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const faintColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundFaint });

interface SidebarV2SearchProps {
  threads: readonly SidebarV2Thread[];
  isSearching: boolean;
  activeResultIndex: number;
  onOpenThread: (thread: SidebarV2Thread) => void;
}

export function SidebarV2Search({
  threads,
  isSearching,
  activeResultIndex,
  onOpenThread,
}: SidebarV2SearchProps) {
  const { t } = useTranslation();
  const searchQuery = useSidebarV2Store((state) => state.searchQuery);
  const setSearchQuery = useSidebarV2Store((state) => state.setSearchQuery);
  const clearSearch = useSidebarV2Store((state) => state.clearSearch);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  const results = useMemo(
    () => searchSidebarThreadsByTitle(threads, searchQuery),
    [threads, searchQuery],
  );

  const handleKeyDown = useCallback(
    (key: string) => {
      if (key === "Escape") {
        clearSearch();
        inputRef.current?.blur();
      }
    },
    [clearSearch],
  );

  const handleSelectResult = useCallback(
    (thread: SidebarV2Thread) => {
      onOpenThread(thread);
      clearSearch();
    },
    [clearSearch, onOpenThread],
  );

  const handleFocus = useCallback(() => setInputFocused(true), []);
  const handleBlur = useCallback(() => setInputFocused(false), []);
  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => handleKeyDown(event.nativeEvent.key),
    [handleKeyDown],
  );

  const searchRowStyle = useMemo(
    () => (inputFocused ? [styles.searchRow, styles.searchRowFocused] : styles.searchRow),
    [inputFocused],
  );

  return (
    <View style={styles.container}>
      <View style={searchRowStyle}>
        <ThemedIconHost
          Icon={SearchIcon}
          size={ICON_SIZE.sm}
          uniProps={foregroundMutedColorMapping}
        />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyPress={handleKeyPress}
          placeholder={t("sidebarV2.searchPlaceholder")}
          accessibilityRole="search"
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={clearSearch} hitSlop={8} testID="sidebar-v2-search-clear">
            <ThemedIconHost Icon={X} size={ICON_SIZE.sm} uniProps={faintColorMapping} />
          </Pressable>
        ) : null}
      </View>

      {isSearching ? (
        <View style={styles.resultsContainer}>
          {results.length === 0 ? (
            <Text style={styles.emptyText}>{t("sidebarV2.noSearchResults")}</Text>
          ) : (
            results.map((thread, index) => (
              <SearchResultRow
                key={thread.id}
                thread={thread}
                active={index === activeResultIndex}
                index={index}
                onOpen={handleSelectResult}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function SearchResultRow({
  thread,
  active,
  index,
  onOpen,
}: {
  thread: SidebarV2Thread;
  active: boolean;
  index: number;
  onOpen: (thread: SidebarV2Thread) => void;
}) {
  const rowStyle = useMemo(
    () => (active ? [styles.resultRow, styles.resultRowActive] : styles.resultRow),
    [active],
  );
  const handlePress = useCallback(() => onOpen(thread), [onOpen, thread]);
  return (
    <Pressable style={rowStyle} onPress={handlePress} testID={`sidebar-v2-search-result-${index}`}>
      <Text style={styles.resultTitle} numberOfLines={1}>
        {thread.title}
      </Text>
      <Text style={styles.resultProject} numberOfLines={1}>
        {thread.projectName ?? ""}
      </Text>
    </Pressable>
  );
}

/** New-thread button, T3-style SquarePen in the sidebar header. */
export function SidebarV2NewThreadButton({
  disabled,
  onPress,
}: {
  disabled?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const buttonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) =>
      [styles.newThreadButton, pressed && styles.newThreadPressed] as StyleProp<ViewStyle>,
    [],
  );
  return (
    <Pressable
      style={buttonStyle}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("sidebarV2.newThread")}
      testID="sidebar-v2-new-thread"
    >
      <ThemedIconHost Icon={SquarePen} size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[0.5],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[1],
    height: 34,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  searchRowFocused: {
    borderColor: theme.colors.borderAccent,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.foreground,
    paddingVertical: 0,
  },
  resultsContainer: {
    gap: 2,
    maxHeight: 260,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
  },
  resultRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  resultTitle: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.foreground,
  },
  resultProject: {
    fontSize: 11,
    color: theme.colors.foregroundFaint,
    maxWidth: 120,
  },
  emptyText: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  newThreadButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  newThreadPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
}));
