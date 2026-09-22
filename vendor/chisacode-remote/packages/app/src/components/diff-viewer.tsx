import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView as RNScrollView,
  type PressableStateCallbackType,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink } from "lucide-react-native";
import { Fonts } from "@/constants/theme";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { diffLinePrefix } from "@/utils/diff-highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import { getCodeInsets } from "./code-insets";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ScrollView = isWeb ? RNScrollView : GHScrollView;

// ---------------------------------------------------------------------------
// DiffStatsBadge – shows +N / -M counts above the diff
// ---------------------------------------------------------------------------

function DiffStatsBadge({ addCount, removeCount }: { addCount: number; removeCount: number }) {
  if (addCount === 0 && removeCount === 0) return null;

  return (
    <View style={styles.statsBadge}>
      <Text style={styles.statsAddText}>+{addCount}</Text>
      <Text style={styles.statsRemoveText}> -{removeCount}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DiffLineRow – single diff line (with optional line number & hover)
// ---------------------------------------------------------------------------

function DiffLineRow({
  line,
  showLineNumbers,
  lineNumber,
  totalLines,
}: {
  line: DiffLine;
  showLineNumbers?: boolean;
  lineNumber?: number;
  totalLines?: number;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  const lineContainerStyle = React.useMemo(
    () => [
      styles.line,
      line.type === "header" && styles.headerLine,
      line.type === "add" && styles.addLine,
      line.type === "remove" && styles.removeLine,
      line.type === "context" && styles.contextLine,
      isHovered && styles.lineHovered,
    ],
    [line.type, isHovered],
  );
  const plainLineTextStyle = React.useMemo(
    () => [
      styles.lineText,
      line.type === "header" && styles.headerText,
      line.type === "add" && styles.addText,
      line.type === "remove" && styles.removeText,
      line.type === "context" && styles.contextText,
    ],
    [line.type],
  );

  const prefixStyle = React.useMemo(
    () => [
      line.type === "add" && styles.addText,
      line.type === "remove" && styles.removeText,
      line.type === "context" && styles.contextText,
    ],
    [line.type],
  );

  const lineWidth =
    showLineNumbers && totalLines ? Math.max(String(totalLines).length * 8, 24) : undefined;
  const lineNumberStyle = React.useMemo(
    () =>
      lineWidth !== undefined
        ? [styles.lineNumberText, inlineUnistylesStyle({ minWidth: lineWidth })]
        : undefined,
    [lineWidth],
  );
  const lineBodyStyle = lineNumberStyle ? styles.lineWithNumbers : undefined;

  // Pick the correct wrapper: Pressable on web for hover, plain View on native
  const Wrapper = isWeb ? Pressable : View;

  const wrapperProps: Record<string, unknown> = isWeb
    ? {
        onHoverIn: () => setIsHovered(true),
        onHoverOut: () => setIsHovered(false),
        style: lineContainerStyle,
      }
    : { style: lineContainerStyle };

  const lineContent = line.tokens ? (
    <View style={lineBodyStyle}>
      {showLineNumbers && lineNumberStyle && lineNumber != null && (
        <Text style={lineNumberStyle} numberOfLines={1}>
          {lineNumber}
        </Text>
      )}
      <View style={styles.lineContentArea}>
        <Text style={styles.lineText}>
          <Text style={prefixStyle}>{diffLinePrefix(line)}</Text>
          <DiffTokens tokens={line.tokens} />
        </Text>
      </View>
    </View>
  ) : (
    <View style={lineBodyStyle}>
      {showLineNumbers && lineNumberStyle && lineNumber != null && (
        <Text style={lineNumberStyle} numberOfLines={1}>
          {lineNumber}
        </Text>
      )}
      <View style={styles.lineContentArea}>
        {line.segments ? (
          <Text style={styles.lineText}>
            <Text style={line.type === "add" ? styles.addText : styles.removeText}>
              {line.content[0]}
            </Text>
            {line.segments.map((segment) => (
              <DiffSegment
                key={`${segment.changed ? "c" : "u"}:${segment.text}`}
                segment={segment}
                lineType={line.type}
              />
            ))}
          </Text>
        ) : (
          <Text style={plainLineTextStyle}>{line.content}</Text>
        )}
      </View>
    </View>
  );

  return <Wrapper {...wrapperProps}>{lineContent}</Wrapper>;
}

function DiffTokens({ tokens }: { tokens: NonNullable<DiffLine["tokens"]> }) {
  const keyed = React.useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <>
      {keyed.map(({ key, token }) => (
        <Text key={key} style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
          {token.text}
        </Text>
      ))}
    </>
  );
}

function DiffSegment({
  segment,
  lineType,
}: {
  segment: NonNullable<DiffLine["segments"]>[number];
  lineType: DiffLine["type"];
}) {
  const segmentStyle = React.useMemo(
    () => [
      lineType === "add" ? styles.addText : styles.removeText,
      segment.changed && (lineType === "add" ? styles.addHighlight : styles.removeHighlight),
    ],
    [lineType, segment.changed],
  );
  return <Text style={segmentStyle}>{segment.text}</Text>;
}

// ---------------------------------------------------------------------------
// DiffViewerProps & DiffViewer
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  diffLines: DiffLine[];
  maxHeight?: number;
  emptyLabel?: string;
  fillAvailableHeight?: boolean;
  onOpenInDiffPane?: () => void;
  showLineNumbers?: boolean;
}

export function DiffViewer({
  diffLines,
  maxHeight,
  emptyLabel = "No changes to display",
  fillAvailableHeight = false,
  onOpenInDiffPane,
  showLineNumbers = false,
}: DiffViewerProps) {
  const [scrollViewWidth, setScrollViewWidth] = React.useState(0);
  const { t } = useTranslation();
  const webScrollbarStyle = useWebScrollbarStyle();
  const handleInnerLayout = React.useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) =>
      setScrollViewWidth(e.nativeEvent.layout.width),
    [],
  );

  const outerScrollStyle = React.useMemo(
    () => [
      styles.verticalScroll,
      maxHeight !== undefined && inlineUnistylesStyle({ maxHeight }),
      fillAvailableHeight && styles.fillHeight,
      webScrollbarStyle,
    ],
    [maxHeight, fillAvailableHeight, webScrollbarStyle],
  );
  const linesContainerStyle = React.useMemo(
    () => [
      styles.linesContainer,
      scrollViewWidth > 0 && inlineUnistylesStyle({ minWidth: scrollViewWidth }),
    ],
    [scrollViewWidth],
  );

  // Compute stats and keyed lines with optional line numbers
  const { addCount, removeCount, keyedWithLineNumbers, totalLines } = React.useMemo(() => {
    let add = 0;
    let remove = 0;
    let lineCounter = 0;
    const keyed = diffLines.map((line, index) => {
      if (line.type === "add") add++;
      if (line.type === "remove") remove++;
      const isHeader = line.type === "header";
      if (!isHeader) lineCounter++;
      return {
        key: `${index}-${line.type}-${line.content}`,
        line,
        lineNumber: isHeader ? undefined : lineCounter,
      };
    });
    return {
      addCount: add,
      removeCount: remove,
      keyedWithLineNumbers: keyed,
      totalLines: lineCounter,
    };
  }, [diffLines]);

  const webVerticalContentStyle = React.useMemo(
    () => [styles.verticalContent, fillAvailableHeight && styles.fillHeight],
    [fillAvailableHeight],
  );
  const openInDiffPaneButtonStyle = React.useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.openInDiffPaneButton,
      hovered && styles.openInDiffPaneButtonHovered,
    ],
    [],
  );

  if (!diffLines.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  const lines = (
    <View style={linesContainerStyle}>
      <DiffStatsBadge addCount={addCount} removeCount={removeCount} />
      {keyedWithLineNumbers.map(({ key, line, lineNumber }) => (
        <DiffLineRow
          key={key}
          line={line}
          showLineNumbers={showLineNumbers}
          lineNumber={lineNumber}
          totalLines={totalLines}
        />
      ))}
    </View>
  );

  const horizontalScroll = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={webScrollbarStyle}
      contentContainerStyle={styles.horizontalContent}
      onLayout={handleInnerLayout}
    >
      {lines}
    </ScrollView>
  );

  const content = (
    <View style={styles.wrapper}>
      <ScrollView
        style={outerScrollStyle}
        contentContainerStyle={webVerticalContentStyle}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {horizontalScroll}
      </ScrollView>
      {onOpenInDiffPane && (
        <Pressable
          style={openInDiffPaneButtonStyle}
          onPress={onOpenInDiffPane}
          accessibilityRole="button"
          accessibilityLabel="Open in DiffPane"
        >
          <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.openInDiffPaneText}>{t("workspace.diffOpenInPane")}</Text>
        </Pressable>
      )}
    </View>
  );

  return content;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => {
  const insets = getCodeInsets(theme);

  return {
    wrapper: {
      position: "relative" as const,
    },
    verticalScroll: {},
    fillHeight: {
      flex: 1,
      minHeight: 0,
    },
    verticalContent: {
      flexGrow: 1,
      paddingBottom: insets.extraBottom,
    },
    horizontalContent: {
      flexDirection: "column" as const,
      paddingRight: insets.extraRight,
    },
    linesContainer: {
      alignSelf: "flex-start",
      padding: insets.padding,
    },

    // -- DiffStatsBadge --
    statsBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      marginBottom: theme.spacing[2],
      paddingHorizontal: theme.spacing[1],
    },
    statsAddText: {
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.diffAddition,
    },
    statsRemoveText: {
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.diffDeletion,
    },

    // -- DiffLineRow --
    line: {
      minWidth: "100%",
      paddingHorizontal: 0,
      paddingVertical: theme.spacing[1],
    },
    lineWithNumbers: {
      flexDirection: "row" as const,
    },
    lineHovered: {
      backgroundColor: isWeb ? `${theme.colors.surface1}88` : undefined,
    },
    lineNumberText: {
      fontFamily: Fonts.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      textAlign: "right" as const,
      paddingRight: theme.spacing[2],
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
      marginRight: theme.spacing[2],
      userSelect: "none" as const,
    },
    lineContentArea: {
      flex: 1,
    },
    lineText: {
      fontFamily: Fonts.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foreground,
      ...(isWeb
        ? {
            whiteSpace: "pre",
            overflowWrap: "normal",
          }
        : null),
    },
    // Soft diff chrome: quiet workspace wash.
    headerLine: {
      backgroundColor: theme.colors.surfaceWorkspace,
    },
    headerText: {
      color: theme.colors.foregroundMuted,
    },
    addLine: {
      backgroundColor: theme.colors.diffAdditionBg,
    },
    addText: {
      color: theme.colors.foreground,
    },
    removeLine: {
      backgroundColor: theme.colors.diffDeletionBg,
    },
    removeText: {
      color: theme.colors.foreground,
    },
    addHighlight: {
      backgroundColor: theme.colors.diffAdditionHighlightBg,
    },
    removeHighlight: {
      backgroundColor: theme.colors.diffDeletionHighlightBg,
    },
    contextLine: {
      backgroundColor: theme.colors.surfaceWorkspace,
    },
    contextText: {
      color: theme.colors.foregroundMuted,
    },

    // -- Empty state --
    emptyState: {
      padding: theme.spacing[4],
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emptyText: {
      fontSize: 12.5,
      lineHeight: 16,
      color: theme.colors.foregroundMuted,
    },

    // -- Open in DiffPane button --
    openInDiffPaneButton: {
      position: "absolute" as const,
      top: theme.spacing[1],
      right: theme.spacing[1],
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      padding: 4,
      borderRadius: 10,
      backgroundColor: theme.colors.surface0,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    openInDiffPaneButtonHovered: {
      backgroundColor: theme.colors.surfaceWorkspace,
    },
    openInDiffPaneText: {
      fontSize: 12.5,
      lineHeight: 16,
      color: theme.colors.foregroundMuted,
      ...(isWeb ? { cursor: "pointer" as const } : null),
    },
  };
});
