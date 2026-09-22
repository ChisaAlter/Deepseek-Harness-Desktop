import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ScrollView,
  Text,
  View,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { File, Folder } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { WORKBENCH_ENVIRONMENT_PANEL_SHADOW } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { getAutocompleteScrollOffset } from "./autocomplete-utils";

const ThemedFolder = withUnistyles(Folder);
const ThemedFile = withUnistyles(File);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface AutocompleteOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  kind?: "command" | "file" | "directory";
}

interface AutocompleteProps {
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  maxHeight?: number;
}

const BOLT_GLYPH_PATTERN = /\u26A1|\uFE0F/gu;

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

interface AutocompleteRowProps {
  index: number;
  option: AutocompleteOption;
  isSelected: boolean;
  onSelect: (option: AutocompleteOption) => void;
  onRowLayout: (index: number, event: LayoutChangeEvent) => void;
}

function AutocompleteRow({
  index,
  option,
  isSelected,
  onSelect,
  onRowLayout,
}: AutocompleteRowProps) {
  const optionLabel = removeBoltGlyphs(option.label) ?? option.label;
  const optionDescription = removeBoltGlyphs(option.description);
  const isFileOrDir = option.kind === "directory" || option.kind === "file";

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onRowLayout(index, event),
    [index, onRowLayout],
  );
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      // Soft: keyboard/selected wash surface3; hover surface1.
      isSelected && styles.itemSelected,
      !isSelected && (hovered || pressed) && styles.itemHovered,
    ],
    [isSelected],
  );

  return (
    <Pressable onLayout={handleLayout} onPress={handlePress} style={pressableStyle}>
      {isFileOrDir ? (
        <>
          <View style={styles.itemLeading}>
            {option.kind === "directory" ? (
              <ThemedFolder size={14} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedFile size={14} uniProps={foregroundMutedColorMapping} />
            )}
          </View>
          <View style={styles.itemMain}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemLabel}>{optionLabel}</Text>
              {removeBoltGlyphs(option.detail) ? (
                <Text style={styles.itemDetail}>{removeBoltGlyphs(option.detail)}</Text>
              ) : null}
            </View>
            {optionDescription ? (
              <Text style={styles.itemDescription} numberOfLines={1}>
                {optionDescription}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.itemMainRow}>
          <Text style={styles.itemLabel}>{optionLabel}</Text>
          {optionDescription ? (
            <Text style={styles.itemDescriptionInline} numberOfLines={1}>
              {optionDescription}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function Autocomplete({
  options,
  selectedIndex,
  onSelect,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  maxHeight = 220,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const resolvedLoadingText = loadingText ?? t("common.loading");
  const resolvedEmptyText = emptyText ?? t("autocomplete.empty");
  const scrollRef = useRef<ScrollView>(null);
  const rowLayoutsRef = useRef<Map<number, { top: number; height: number }>>(new Map());
  const viewportHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const ensureActiveItemVisible = useCallback(() => {
    if (selectedIndex < 0) {
      return;
    }

    const layout = rowLayoutsRef.current.get(selectedIndex);
    if (!layout) {
      return;
    }

    const nextOffset = getAutocompleteScrollOffset({
      currentOffset: scrollOffsetRef.current,
      viewportHeight: viewportHeightRef.current,
      itemTop: layout.top,
      itemHeight: layout.height,
    });

    if (Math.abs(nextOffset - scrollOffsetRef.current) < 1) {
      return;
    }

    scrollOffsetRef.current = nextOffset;
    scrollRef.current?.scrollTo({ y: nextOffset, animated: false });
  }, [selectedIndex]);

  const pinToBottom = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  useEffect(() => {
    rowLayoutsRef.current.clear();
    scrollOffsetRef.current = 0;
  }, [options]);

  useEffect(() => {
    if (options.length === 0) {
      return;
    }
    pinToBottom();
  }, [options, pinToBottom]);

  useEffect(() => {
    const raf = requestAnimationFrame(ensureActiveItemVisible);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [ensureActiveItemVisible, options.length]);

  const handleScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleRowLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      rowLayoutsRef.current.set(index, {
        top: event.nativeEvent.layout.y,
        height: event.nativeEvent.layout.height,
      });
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const selectedOption = options[selectedIndex];
  const containerStyle = useMemo(() => [styles.container, { maxHeight }], [maxHeight]);

  if (isLoading) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedLoadingText}</Text>
        </View>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>Error: {errorMessage}</Text>
        </View>
      </View>
    );
  }

  if (options.length === 0) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedEmptyText}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outerWrapper}>
      {selectedOption?.kind === "command" && selectedOption.description ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailLabel}>
            {removeBoltGlyphs(selectedOption.label) ?? selectedOption.label}
          </Text>
          <Text style={styles.detailDescription}>
            {removeBoltGlyphs(selectedOption.description)}
          </Text>
          {selectedOption.detail ? (
            <Text style={styles.detailHint}>{removeBoltGlyphs(selectedOption.detail)}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={containerStyle}>
        <ScrollView
          ref={scrollRef}
          onLayout={handleScrollViewLayout}
          onContentSizeChange={pinToBottom}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
        >
          {options.map((option, index) => (
            <AutocompleteRow
              key={option.id}
              index={index}
              option={option}
              isSelected={index === selectedIndex}
              onSelect={onSelect}
              onRowLayout={handleRowLayout}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  outerWrapper: {
    gap: theme.spacing[1],
  },
  detailCard: {
    // Soft quiet elevated card (r14 family).
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    ...theme.shadow.sm,
  },
  detailLabel: {
    color: theme.colors.foreground,
    // Soft autocomplete detail: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
  },
  detailDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  detailHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  // Soft .menu-hint panel: r12 pad 6 + Soft ink shadow.
  container: {
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 12,
    overflow: "hidden",
    padding: 6,
    ...(isWeb ? ({ boxShadow: WORKBENCH_ENVIRONMENT_PANEL_SHADOW } as object) : theme.shadow.md),
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingVertical: 0,
  },
  // Soft .menu-hint row: pad 8 10 r8 12.5.
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  itemLeading: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
  },
  itemHovered: {
    // Soft menu-hint hover: --hover surface1.
    backgroundColor: theme.colors.surface1,
  },
  itemSelected: {
    // Soft keyboard/selected wash: surface3.
    backgroundColor: theme.colors.surface3,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  itemMainRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  itemLabel: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  itemDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  itemDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 2,
  },
  itemDescriptionInline: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  emptyItem: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    // Soft autocomplete detail: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
})) as unknown as Record<string, object>;
