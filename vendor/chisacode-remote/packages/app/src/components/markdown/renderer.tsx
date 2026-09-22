import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Image,
  Pressable,
  Text,
  View,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import Markdown, {
  MarkdownIt,
  type ASTNode,
  type RenderRules,
} from "react-native-markdown-display";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownParagraphView, MarkdownTextSpan } from "@/components/markdown-text";
import { MarkdownTableCellText } from "@/components/markdown-text-selection";
import { getMarkdownListMarker, getMarkdownListSpacing } from "@/utils/markdown-list";
import { markdownNodeContainsType } from "@/utils/markdown-ast";
import {
  createCompactMarkdownStyles,
  createMarkdownStyles,
  createWorkbenchMarkdownStyles,
} from "@/styles/markdown-styles";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { truncateCjkUrl } from "@/utils/markdown-utils";
import {
  splitHtmlishMarkdown,
  type MarkdownDisplayPart,
  type MarkdownInlineImagePart,
} from "./html-ish";
import { resolveInlineImageSize, type InlineImageDimensions } from "./inline-image-size";
import { mergeMarkdownRules } from "./merge-rules";
import { groupMarkdownParts, type MarkdownPartGroup } from "./part-groups";

export type MarkdownStyles = Record<string, TextStyle & ViewStyle & { [key: string]: unknown }>;

/** Style scale for MarkdownRenderer. Compact wins over workbench when both are set. */
export type MarkdownStyleVariant = "default" | "compact" | "workbench";

interface MarkdownWithStableRendererProps {
  children: ReactNode;
  style:
    | ReturnType<typeof createMarkdownStyles>
    | ReturnType<typeof createCompactMarkdownStyles>
    | ReturnType<typeof createWorkbenchMarkdownStyles>;
  rules?: RenderRules;
  markdownit?: ReturnType<typeof MarkdownIt>;
  onLinkPress?: (url: string) => boolean;
  allowedImageHandlers?: readonly string[];
  topLevelMaxExceededItem?: ReactNode;
}

const MarkdownWithStableRenderer = Markdown as ComponentType<MarkdownWithStableRendererProps>;
const ThemedMarkdown = withUnistyles(MarkdownWithStableRenderer);

function markdownStyleMapping(theme: Theme): Partial<MarkdownWithStableRendererProps> {
  return { style: createMarkdownStyles(theme) };
}

function compactMarkdownStyleMapping(theme: Theme): Partial<MarkdownWithStableRendererProps> {
  return { style: createCompactMarkdownStyles(theme) };
}

function workbenchMarkdownStyleMapping(theme: Theme): Partial<MarkdownWithStableRendererProps> {
  return { style: createWorkbenchMarkdownStyles(theme) };
}

function resolveMarkdownStyleMapping(
  variant: MarkdownStyleVariant,
): (theme: Theme) => Partial<MarkdownWithStableRendererProps> {
  if (variant === "compact") {
    return compactMarkdownStyleMapping;
  }
  if (variant === "workbench") {
    return workbenchMarkdownStyleMapping;
  }
  return markdownStyleMapping;
}

const defaultMarkdownParser = MarkdownIt({ typographer: true, linkify: true });
const EMPTY_TEXT_STYLE: TextStyle = {};
const MARKDOWN_LIST_ITEM_CONTENT_FLEX: ViewStyle = { flex: 1, flexShrink: 1, minWidth: 0 };
export interface MarkdownRendererProps {
  text: string;
  /**
   * Compact chrome (thoughts/plans). Takes precedence over `variant`.
   * Prefer `variant="workbench"` for Soft chat stream prose.
   */
  compact?: boolean;
  /**
   * Soft stream uses `"workbench"` (14.5 / 1.65). File previews keep `"default"`.
   * When `compact` is true, this is ignored.
   */
  variant?: MarkdownStyleVariant;
  /**
   * Domain-specific rule overrides merged on top of createSharedMarkdownRules().
   * Pass only ChisaCode extensions (file links, generative fences, etc.) — do not
   * re-declare shared list/paragraph/strong rules unless intentionally replacing them.
   */
  rules?: RenderRules;
  markdownit?: ReturnType<typeof MarkdownIt>;
  onLinkPress?: (url: string) => boolean;
  allowedImageHandlers?: readonly string[];
  topLevelMaxExceededItem?: ReactNode;
  enableHtmlish?: boolean;
}

/** Stable base rule set — recreated only if createSharedMarkdownRules changes. */
let sharedMarkdownRulesCache: RenderRules | null = null;

function getSharedMarkdownRules(): RenderRules {
  sharedMarkdownRulesCache ??= createSharedMarkdownRules();
  return sharedMarkdownRulesCache;
}

export function MarkdownRenderer({
  text,
  compact = false,
  variant = "default",
  rules,
  markdownit = defaultMarkdownParser,
  onLinkPress,
  allowedImageHandlers,
  topLevelMaxExceededItem,
  enableHtmlish = true,
}: MarkdownRendererProps) {
  // Domain surfaces pass only extension keys (file links, generative UI, …).
  // Shared list/paragraph/code/table/link behavior always comes from the core.
  const markdownRules = useMemo(() => mergeMarkdownRules(getSharedMarkdownRules(), rules), [rules]);
  const parts = useMemo(
    () => (enableHtmlish ? splitHtmlishMarkdown(text) : [{ kind: "markdown" as const, text }]),
    [enableHtmlish, text],
  );
  const styleVariant: MarkdownStyleVariant = compact ? "compact" : variant;
  const rendererProps = useMemo(
    () => ({
      compact,
      variant: styleVariant,
      rules: markdownRules,
      markdownit,
      onLinkPress,
      allowedImageHandlers,
      topLevelMaxExceededItem,
    }),
    [
      allowedImageHandlers,
      compact,
      markdownRules,
      markdownit,
      onLinkPress,
      styleVariant,
      topLevelMaxExceededItem,
    ],
  );

  return (
    <AppearanceStyleBoundary>
      <MarkdownPartList parts={parts} rendererProps={rendererProps} />
    </AppearanceStyleBoundary>
  );
}

type MarkdownPartRendererProps = Omit<MarkdownRendererProps, "text" | "enableHtmlish"> & {
  rules: RenderRules;
};

function MarkdownPartList({
  parts,
  rendererProps,
}: {
  parts: MarkdownDisplayPart[];
  rendererProps: MarkdownPartRendererProps;
}) {
  const keyedGroups = useMemo(() => keyMarkdownGroups(groupMarkdownParts(parts)), [parts]);
  return (
    <>
      {keyedGroups.map(({ key, group }) =>
        group.kind === "part" ? (
          <MarkdownPart key={key} part={group.part} rendererProps={rendererProps} />
        ) : (
          <MarkdownImageTextGroup key={key} group={group} rendererProps={rendererProps} />
        ),
      )}
    </>
  );
}

function keyMarkdownGroups(
  groups: MarkdownPartGroup[],
): { key: string; group: MarkdownPartGroup }[] {
  const seen = new Map<string, number>();
  return groups.map((group) => {
    const identity =
      group.kind === "part"
        ? getMarkdownPartIdentity(group.part)
        : `imageText:${group.images.map((i) => i.src).join(",")}:${group.lead.slice(0, 80)}`;
    const seenCount = seen.get(identity) ?? 0;
    seen.set(identity, seenCount + 1);
    return { key: `${identity}:${seenCount}`, group };
  });
}

function getMarkdownPartIdentity(part: MarkdownDisplayPart): string {
  if (part.kind === "markdown") {
    return `markdown:${part.text.slice(0, 80)}`;
  }
  if (part.kind === "inlineImage") {
    return `inlineImage:${part.src}:${part.alt}`;
  }
  return `details:${part.summary.slice(0, 80)}:${part.body.slice(0, 80)}`;
}

function MarkdownPart({
  part,
  rendererProps,
}: {
  part: MarkdownDisplayPart;
  rendererProps: MarkdownPartRendererProps;
}) {
  if (part.kind === "details") {
    return <MarkdownDetails part={part} rendererProps={rendererProps} />;
  }

  if (part.kind === "inlineImage") {
    return <MarkdownInlineImage part={part} onLinkPress={rendererProps.onLinkPress} />;
  }

  if (part.text.length === 0) {
    return null;
  }

  return <MarkdownFragment text={part.text} {...rendererProps} />;
}

function MarkdownFragment({
  text,
  compact = false,
  variant = "default",
  rules,
  markdownit,
  onLinkPress,
  allowedImageHandlers,
  topLevelMaxExceededItem,
}: MarkdownRendererProps & { rules: RenderRules }) {
  const styleVariant: MarkdownStyleVariant = compact ? "compact" : variant;
  const uniProps = resolveMarkdownStyleMapping(styleVariant);
  return (
    <ThemedMarkdown
      uniProps={uniProps}
      rules={rules}
      markdownit={markdownit}
      onLinkPress={onLinkPress}
      allowedImageHandlers={allowedImageHandlers}
      topLevelMaxExceededItem={topLevelMaxExceededItem}
    >
      {text}
    </ThemedMarkdown>
  );
}

function useNaturalImageDimensions(part: MarkdownInlineImagePart): {
  natural: InlineImageDimensions | null;
  failed: boolean;
  setFailed: (failed: boolean) => void;
} {
  const [natural, setNatural] = useState<InlineImageDimensions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (part.width && part.height) {
      return;
    }

    let cancelled = false;
    Image.getSize(
      part.src,
      (width, height) => {
        if (!cancelled) {
          setNatural({ width, height });
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [part.height, part.src, part.width]);

  return { natural, failed, setFailed };
}

function MarkdownInlineImage({
  part,
  onLinkPress,
}: {
  part: Extract<MarkdownDisplayPart, { kind: "inlineImage" }>;
  onLinkPress?: (url: string) => boolean;
}) {
  const { natural: naturalDimensions } = useNaturalImageDimensions(part);
  const explicitDimensions = useMemo(
    () => ({ width: part.width, height: part.height }),
    [part.height, part.width],
  );
  const handlePress = useCallback(() => {
    if (!part.href) return;
    if (onLinkPress?.(part.href) === false) return;
    void openExternalUrl(part.href);
  }, [onLinkPress, part.href]);
  const source = useMemo(() => ({ uri: part.src }), [part.src]);
  const imageSize = useMemo(
    () => resolveInlineImageSize({ explicit: explicitDimensions, natural: naturalDimensions }),
    [explicitDimensions, naturalDimensions],
  );
  const imageStyle = useMemo(() => [detailsStyles.inlineImage, imageSize], [imageSize]);

  const image = (
    <Image
      source={source}
      style={imageStyle}
      resizeMode="contain"
      accessibilityLabel={part.alt || undefined}
    />
  );

  if (!part.href) {
    return <View style={detailsStyles.inlineImageWrap}>{image}</View>;
  }

  return (
    <Pressable style={detailsStyles.inlineImageWrap} onPress={handlePress} accessibilityRole="link">
      {image}
    </Pressable>
  );
}

const FLOW_IMAGE_MAX_HEIGHT = 18;

function MarkdownFlowImage({
  part,
  onLinkPress,
}: {
  part: MarkdownInlineImagePart;
  onLinkPress?: (url: string) => boolean;
}) {
  const { natural, failed, setFailed } = useNaturalImageDimensions(part);
  const handlePress = useCallback(() => {
    if (!part.href) return;
    if (onLinkPress?.(part.href) === false) return;
    void openExternalUrl(part.href);
  }, [onLinkPress, part.href]);
  const handleError = useCallback(() => setFailed(true), [setFailed]);
  const source = useMemo(() => ({ uri: part.src }), [part.src]);
  const imageSize = useMemo(() => {
    const size = resolveInlineImageSize({
      explicit: { width: part.width, height: part.height },
      natural,
    });
    const scale = Math.min(1, FLOW_IMAGE_MAX_HEIGHT / size.height);
    return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
  }, [natural, part.height, part.width]);
  const imageStyle = useMemo(() => [detailsStyles.flowImage, imageSize], [imageSize]);

  if (failed) {
    if (!part.alt) {
      return null;
    }
    return (
      <View style={detailsStyles.flowImageFallback}>
        <Text style={detailsStyles.flowImageFallbackText}>{part.alt}</Text>
      </View>
    );
  }

  const image = (
    <Image
      source={source}
      style={imageStyle}
      resizeMode="contain"
      accessibilityLabel={part.alt || undefined}
      onError={handleError}
    />
  );

  if (!part.href) {
    return image;
  }

  return (
    <Pressable onPress={handlePress} accessibilityRole="link">
      {image}
    </Pressable>
  );
}

function MarkdownImageTextGroup({
  group,
  rendererProps,
}: {
  group: Extract<MarkdownPartGroup, { kind: "imageText" }>;
  rendererProps: MarkdownPartRendererProps;
}) {
  return (
    <>
      <View style={detailsStyles.imageTextRow}>
        {group.images.map((image) => (
          <MarkdownFlowImage key={image.src} part={image} onLinkPress={rendererProps.onLinkPress} />
        ))}
        <View style={detailsStyles.imageTextRowContent}>
          <MarkdownFragment text={group.lead} {...rendererProps} />
        </View>
      </View>
      {group.rest ? <MarkdownFragment text={group.rest} {...rendererProps} /> : null}
    </>
  );
}

function MarkdownDetails({
  part,
  rendererProps,
}: {
  part: Extract<MarkdownDisplayPart, { kind: "details" }>;
  rendererProps: MarkdownPartRendererProps;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const bodyParts = useMemo(
    () => part.bodyParts ?? [{ kind: "markdown" as const, text: part.body }],
    [part.body, part.bodyParts],
  );
  return (
    <View style={detailsStyles.container}>
      <Pressable style={detailsStyles.summaryRow} onPress={toggle} accessibilityRole="button">
        {open ? (
          <ChevronDown size={14} color={detailsStyles.summaryIcon.color} />
        ) : (
          <ChevronRight size={14} color={detailsStyles.summaryIcon.color} />
        )}
        <Text style={detailsStyles.summaryText}>{part.summary}</Text>
      </Pressable>
      {open ? (
        <View style={detailsStyles.body}>
          <MarkdownPartList parts={bodyParts} rendererProps={rendererProps} />
        </View>
      ) : null}
    </View>
  );
}

interface MarkdownInheritedTextProps {
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  style?: TextStyle;
  monoSurface?: boolean;
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
  children: ReactNode;
}

export function MarkdownInheritedText({
  inheritedStyles,
  textStyle,
  style: overrideStyle,
  monoSurface,
  onPress,
  accessibilityRole,
  children,
}: MarkdownInheritedTextProps) {
  const style = useMemo(
    () => [inheritedStyles, textStyle, overrideStyle],
    [inheritedStyles, textStyle, overrideStyle],
  );
  return (
    <MarkdownTextSpan
      monoSurface={monoSurface}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      style={style}
    >
      {children}
    </MarkdownTextSpan>
  );
}

interface MarkdownListItemContentProps {
  contentStyle: ViewStyle;
  children: ReactNode;
}

function MarkdownListItemContent({ contentStyle, children }: MarkdownListItemContentProps) {
  const style = useMemo(() => [contentStyle, MARKDOWN_LIST_ITEM_CONTENT_FLEX], [contentStyle]);
  return <View style={style}>{children}</View>;
}

interface MarkdownListViewProps {
  baseStyle: ViewStyle;
  spacing: { marginTop: number; marginBottom: number };
  children: ReactNode;
}

function MarkdownListView({ baseStyle, spacing, children }: MarkdownListViewProps) {
  const style = useMemo(() => [baseStyle, spacing], [baseStyle, spacing]);
  return <View style={style}>{children}</View>;
}

interface SharedMarkdownLinkProps {
  href: string;
  inheritedStyles: TextStyle;
  linkStyle: TextStyle;
  onLinkPress?: (url: string) => boolean;
  children: ReactNode;
}

function SharedMarkdownLink({
  href,
  inheritedStyles,
  linkStyle,
  onLinkPress,
  children,
}: SharedMarkdownLinkProps) {
  const handlePress = useCallback(() => {
    if (!href) return;
    if (onLinkPress?.(href) === false) return;
    void openExternalUrl(href);
  }, [href, onLinkPress]);

  return (
    <MarkdownInheritedText
      inheritedStyles={inheritedStyles}
      textStyle={linkStyle}
      accessibilityRole="link"
      onPress={handlePress}
    >
      {children}
    </MarkdownInheritedText>
  );
}

function getMarkdownLinkHref(node: ASTNode): string {
  const href = node.attributes?.href;
  if (typeof href !== "string") return "";
  // GFM autolink may swallow CJK/fullwidth characters into the URL.
  const [cleanUrl] = truncateCjkUrl(href);
  return cleanUrl;
}

export function createSharedMarkdownRules(): RenderRules {
  return {
    text: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.text}
      >
        {node.content}
      </MarkdownInheritedText>
    ),
    textgroup: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.textgroup}
      >
        {children}
      </MarkdownInheritedText>
    ),
    strong: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.strong}
      >
        {children}
      </MarkdownInheritedText>
    ),
    em: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText key={node.key} inheritedStyles={inheritedStyles} textStyle={styles.em}>
        {children}
      </MarkdownInheritedText>
    ),
    s: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText key={node.key} inheritedStyles={inheritedStyles} textStyle={styles.s}>
        {children}
      </MarkdownInheritedText>
    ),
    hardbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
    softbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
    code_block: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <HighlightedCodeBlock
        key={node.key}
        code={node.content}
        language={null}
        inheritedStyles={inheritedStyles}
        textStyle={styles.code_block}
      />
    ),
    fence: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <HighlightedCodeBlock
        key={node.key}
        code={node.content}
        language={node.sourceInfo}
        inheritedStyles={inheritedStyles}
        textStyle={styles.fence}
      />
    ),
    code_inline: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.code_inline}
        monoSurface
      >
        {node.content ?? ""}
      </MarkdownInheritedText>
    ),
    bullet_list: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownListView
        key={node.key}
        baseStyle={styles.bullet_list}
        spacing={getMarkdownListSpacing(node, parent)}
      >
        {children}
      </MarkdownListView>
    ),
    ordered_list: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownListView
        key={node.key}
        baseStyle={styles.ordered_list}
        spacing={getMarkdownListSpacing(node, parent)}
      >
        {children}
      </MarkdownListView>
    ),
    list_item: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => {
      const { isOrdered, marker } = getMarkdownListMarker(node, parent);
      const iconStyle = isOrdered ? styles.ordered_list_icon : styles.bullet_list_icon;
      const contentStyle = isOrdered ? styles.ordered_list_content : styles.bullet_list_content;

      return (
        <View key={node.key} style={styles.list_item}>
          <Text style={iconStyle}>{marker}</Text>
          <MarkdownListItemContent contentStyle={contentStyle}>{children}</MarkdownListItemContent>
        </View>
      );
    },
    th: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
      <MarkdownTableCellText key={node.key}>
        <View style={styles._VIEW_SAFE_th}>{children}</View>
      </MarkdownTableCellText>
    ),
    td: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
      <MarkdownTableCellText key={node.key}>
        <View style={styles._VIEW_SAFE_td}>{children}</View>
      </MarkdownTableCellText>
    ),
    paragraph: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownParagraphView
        key={node.key}
        paragraphStyle={styles.paragraph}
        containsImage={markdownNodeContainsType(node, "image")}
      >
        {children}
      </MarkdownParagraphView>
    ),
    link: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      onLinkPress?: (url: string) => boolean,
    ) => (
      <SharedMarkdownLink
        key={node.key}
        href={getMarkdownLinkHref(node)}
        inheritedStyles={EMPTY_TEXT_STYLE}
        linkStyle={styles.link}
        onLinkPress={onLinkPress}
      >
        {children}
      </SharedMarkdownLink>
    ),
  };
}

const detailsStyles = StyleSheet.create((theme) => ({
  // Soft .tool-like details chrome.
  container: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    marginBottom: theme.spacing[2],
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  summaryIcon: {
    color: theme.colors.foregroundMuted,
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  inlineImageWrap: {
    alignSelf: "flex-start",
    marginBottom: theme.spacing[1],
  },
  inlineImage: {},
  imageTextRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
  imageTextRowContent: {
    flex: 1,
    minWidth: 0,
  },
  flowImage: {
    marginTop: 2,
  },
  flowImageFallback: {
    marginTop: 2,
    paddingHorizontal: theme.spacing[1],
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  flowImageFallbackText: {
    fontSize: 10,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
}));
