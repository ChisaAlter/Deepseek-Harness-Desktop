import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownTextSpan } from "@/components/markdown-text";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { HighlightToken } from "@chisacode/highlight";
import { isNative, isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import { classifyCodeBlock, parseDiffLines, type DiffLine } from "@/utils/markdown-utils";

interface HighlightedCodeBlockProps {
  code: string;
  language: string | null | undefined;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  /**
   * True while the code block is still streaming in. Streamed (half-rendered)
   * fence content is tokenized without polluting the shared highlight LRU, so
   * completed blocks are never evicted by intermediate frames.
   */
  isStreaming?: boolean;
}

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @chisacode/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

function fenceLanguageToExtension(info: string | null | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

export const HighlightedCodeBlock = React.memo(function HighlightedCodeBlock({
  code,
  language,
  inheritedStyles,
  textStyle,
  isStreaming = false,
}: HighlightedCodeBlockProps) {
  // Box styles (bg / padding / border / radius / margin) go on the wrapper View
  // so the absolute copy button positions relative to the visible code area,
  // not to a parent that includes the Text's own marginVertical.
  const { containerStyle, innerTextStyle } = useMemo(
    () => splitFenceStyle(inheritedStyles, textStyle),
    [inheritedStyles, textStyle],
  );
  const renderedCode = useMemo(() => stripTerminalFenceNewline(code), [code]);
  const blockKind = useMemo(() => classifyCodeBlock(language ?? undefined), [language]);

  const keyedLines = useMemo<KeyedLine[] | null>(
    () =>
      blockKind === "code"
        ? highlightToKeyedLines(renderedCode, fenceLanguageToExtension(language), {
            cacheable: !isStreaming,
          })
        : null,
    [renderedCode, language, blockKind, isStreaming],
  );

  const diffLines = useMemo<DiffLine[] | null>(
    () => (blockKind === "diff" ? parseDiffLines(renderedCode) : null),
    [renderedCode, blockKind],
  );

  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const controlsVisible = isHovered || isNative || isCompact;
  const getCode = useCallback(() => code, [code]);

  return (
    <View
      style={containerStyle}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {renderCodeContent(blockKind, diffLines, keyedLines, renderedCode, innerTextStyle)}
      <CopyButton getCode={getCode} visible={controlsVisible} />
    </View>
  );
});

function renderCodeContent(
  blockKind: "diff" | "diagram" | "math" | "code",
  diffLines: DiffLine[] | null,
  keyedLines: KeyedLine[] | null,
  renderedCode: string,
  innerTextStyle: StyleProp<TextStyle>,
): React.ReactNode {
  if (diffLines) {
    return <View>{renderDiffLines(diffLines, innerTextStyle)}</View>;
  }
  if (keyedLines) {
    return (
      <MarkdownTextSpan style={innerTextStyle}>{renderCodeSegments(keyedLines)}</MarkdownTextSpan>
    );
  }
  // math/diagram blocks have no native renderer (no KaTeX/MathML or mermaid on
  // RN without heavy native modules). Show them with a distinct label + monospace
  // block so users can tell they are specialized content, not plain code.
  if (blockKind === "math" || blockKind === "diagram") {
    return (
      <View style={specializedBlockStyles.container}>
        <MarkdownTextSpan style={specializedBlockStyles.label}>
          {blockKind === "math" ? "math" : "diagram"}
        </MarkdownTextSpan>
        <MarkdownTextSpan style={innerTextStyle}>{renderedCode}</MarkdownTextSpan>
      </View>
    );
  }
  return <MarkdownTextSpan style={innerTextStyle}>{renderedCode}</MarkdownTextSpan>;
}

const specializedBlockStyles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    opacity: 0.5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
});

function renderCodeSegments(keyedLines: KeyedLine[]): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < keyedLines.length; lineIndex += 1) {
    const line = keyedLines[lineIndex];
    if (lineIndex > 0) {
      segments.push(<CodeTextSpan key={`${line.key}-newline`} text={"\n"} />);
    }
    for (const { key, token } of line.tokens) {
      segments.push(<TokenSpan key={`${line.key}-${key}`} token={token} />);
    }
  }
  return segments;
}

function renderDiffLines(
  diffLines: DiffLine[],
  textStyle: StyleProp<TextStyle>,
): React.ReactNode[] {
  return diffLines.map((line, index) => {
    const bgStyle = diffLineBgStyle(line.kind);
    const diffKey = `${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${index}`;
    return (
      <View key={diffKey} style={bgStyle}>
        <MarkdownTextSpan style={textStyle}>{line.raw}</MarkdownTextSpan>
      </View>
    );
  });
}

function diffLineBgStyle(kind: DiffLine["kind"]): ViewStyle | undefined {
  switch (kind) {
    case "add":
      return diffStyles.lineAdd;
    case "delete":
      return diffStyles.lineDelete;
    case "header":
      return diffStyles.lineHeader;
    case "meta":
      return diffStyles.lineMeta;
    default:
      return undefined;
  }
}

const diffStyles = StyleSheet.create((theme) => ({
  lineAdd: {
    backgroundColor: theme.colors.statusSuccess + "22",
  },
  lineDelete: {
    backgroundColor: theme.colors.statusDanger + "22",
  },
  lineHeader: {
    backgroundColor: theme.colors.accent + "18",
  },
  lineMeta: {
    opacity: 0.6,
  },
}));

interface TokenSpanProps {
  token: HighlightToken;
}

const TokenSpan = React.memo(function TokenSpan({ token }: TokenSpanProps) {
  return (
    <MarkdownTextSpan style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
      {token.text}
    </MarkdownTextSpan>
  );
});

interface CodeTextSpanProps {
  text: string;
}

const CodeTextSpan = React.memo(function CodeTextSpan({ text }: CodeTextSpanProps) {
  return <MarkdownTextSpan>{text}</MarkdownTextSpan>;
});

interface SplitStyles {
  containerStyle: StyleProp<ViewStyle>;
  innerTextStyle: StyleProp<TextStyle>;
}

const CONTAINER_BASE: ViewStyle = { position: "relative" };
const WEB_SELECTABLE: TextStyle = isWeb ? ({ userSelect: "text" } as TextStyle) : {};

function splitFenceStyle(inheritedStyles: TextStyle, textStyle: TextStyle): SplitStyles {
  const { fontFamily, fontSize, color, ...box } = textStyle;
  const textOnly: TextStyle = { ...WEB_SELECTABLE };
  if (fontFamily !== undefined) textOnly.fontFamily = fontFamily;
  if (fontSize !== undefined) textOnly.fontSize = fontSize;
  if (fontSize !== undefined) textOnly.lineHeight = Math.round(fontSize * 1.45);
  if (color !== undefined) textOnly.color = color;
  return {
    containerStyle: [box as ViewStyle, CONTAINER_BASE],
    innerTextStyle: [inheritedStyles, textOnly],
  };
}

interface CopyButtonProps {
  getCode: () => string;
  visible: boolean;
}

const COPIED_RESET_MS = 1500;

const CopyButton = React.memo(function CopyButton({ getCode, visible }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handlePress = useCallback(async () => {
    const content = getCode();
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, [getCode]);

  const visibilityStyle = visible
    ? copyButtonStyles.containerVisible
    : copyButtonStyles.containerHidden;
  const wrapperStyle = useMemo(
    () => [copyButtonStyles.container, visibilityStyle],
    [visibilityStyle],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={wrapperStyle}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityRole="button"
      accessibilityLabel={copied ? t("common.copied") : t("common.copyCode")}
      hitSlop={8}
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? copyButtonStyles.iconHoveredColor.color
          : copyButtonStyles.iconColor.color;
        return copied ? (
          <Check size={14} color={iconColor} />
        ) : (
          <Copy size={14} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const copyButtonStyles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    padding: theme.spacing[1],
  },
  containerVisible: {
    opacity: 1,
  },
  containerHidden: {
    opacity: 0,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));
