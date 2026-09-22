import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  type LayoutChangeEvent,
  StyleProp,
  ViewStyle,
  type TextStyle,
} from "react-native";
import * as React from "react";
import {
  useState,
  useEffect,
  useRef,
  memo,
  useMemo,
  useCallback,
  isValidElement,
  Children,
  cloneElement,
} from "react";
import type { ReactNode } from "react";
import { MarkdownIt, type ASTNode, type RenderRules } from "react-native-markdown-display";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Circle,
  Info,
  CheckCircle,
  XCircle,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  CheckSquare,
  Copy,
  MicVocal,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";
import {
  useIsCompactFormFactor,
  WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH,
  WORKBENCH_BODY_FONT_SIZE,
  WORKBENCH_BODY_LINE_HEIGHT,
  WORKBENCH_USER_MESSAGE_MAX_WIDTH,
} from "@/constants/layout";
import {
  MarkdownInheritedText,
  MarkdownRenderer,
  type MarkdownStyles,
} from "@/components/markdown";
import { Fonts } from "@/constants/theme";
import type { GenerativeUiItem, TodoEntry, UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment } from "@chisacode/protocol/messages";
import type { ToolCallDetail } from "@chisacode/protocol/agent-types";
import { buildToolCallPresentation } from "@/tool-calls/presentation";
import { resolveToolCallIcon } from "@/utils/tool-call-icon";
import { useStableEvent } from "@/hooks/use-stable-event";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { GenerativeHtmlPreview } from "@/components/generative-html-preview";
import { GenerativeUiRenderer } from "@/generative-ui/generative-ui-renderer";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { getGenerativeHtmlFence, getGenerativeUiFence } from "@/utils/generative-ui-html";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import {
  getAssistantImageLoadStateFromMetadata,
  getAssistantImageMetadata,
  setAssistantImageMetadata,
  type AssistantImageLoadState,
} from "@/utils/assistant-image-metadata";
import { setAssistantMarkdownBlockHeight } from "@/utils/assistant-message-height-estimate";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import {
  createPreviewAttachmentId,
  getFileNameFromPath,
  parseImageDataUrl,
} from "@/attachments/utils";
import { ExpandableBadge, useDisableOuterSpacing } from "./expandable-badge";
import { PlanCard } from "./plan-card";
import { useToolCallSheet } from "./tool-call-sheet";
import { ToolCallDetailsContent } from "./tool-call-details";
import { stripLeadingMarkdownHorizontalRule } from "./message-markdown";
import {
  AssistantInlineCodePathLink,
  type AssistantFileLinkSource,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
  type InlinePathTarget,
  useAssistantFileLinkActions,
} from "@/assistant-file-links";
import { getCompactionMarkerLabel } from "./message-compaction-label";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes, persistAttachmentFromDataUrl } from "@/attachments/service";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { isWeb, isNative } from "@/constants/platform";
import type { AgentCapabilityFlags } from "@chisacode/protocol/agent-types";
import { RewindMenu, type RewindMode } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
export { MessageOuterSpacingProvider } from "./expandable-badge";
export type { InlinePathTarget } from "@/assistant-file-links";

// Font size for stream metadata (timestamps, durations, live elapsed timer).
// Lives between theme.fontSize.xs (12) and theme.fontSize.sm (14); no token.
export const STREAM_METADATA_FONT_SIZE = 13;

function buildGenerativeUiItem(
  nodeKey: string,
  fence: NonNullable<ReturnType<typeof getGenerativeUiFence>>,
): GenerativeUiItem {
  return {
    kind: "generative_ui",
    id: `genui_${nodeKey}`,
    instanceId: `genui_${nodeKey}`,
    componentId: fence.componentId,
    props: fence.props,
    source: fence.source,
    status: "interactive",
    timestamp: new Date(),
  };
}

interface UserMessageProps {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  message: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  timestamp: number;
  capabilities?: AgentCapabilityFlags;
  client?: DaemonClient | null;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  disableOuterSpacing?: boolean;
}

const EMPTY_USER_MESSAGE_IMAGES: UserMessageImageAttachment[] = [];
const EMPTY_USER_MESSAGE_ATTACHMENTS: AgentAttachment[] = [];

const MARKDOWN_ALLOWED_IMAGE_HANDLERS: string[] = [
  "data:image/png;base64",
  "data:image/gif;base64",
  "data:image/jpeg;base64",
  "https://",
  "http://",
];
const MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM = <Text key="dotdotdot">...</Text>;

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const primaryForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.primaryForeground,
});
const userMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    justifyContent: "flex-end",
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  content: {
    alignItems: "flex-end",
    position: "relative",
    // Paseo: fill available width up to a soft cap instead of a tight 400px bubble.
    maxWidth: WORKBENCH_USER_MESSAGE_MAX_WIDTH,
    minWidth: 0,
    flexShrink: 1,
    cursor: "auto",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerFirstInGroup: {
    marginTop: theme.spacing[4],
  },
  containerLastInGroup: {
    marginBottom: theme.spacing[4],
  },
  bubble: {
    // Soft Workbench .user-b: quiet elevated card bubble.
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minWidth: 0,
    flexShrink: 1,
    ...(isWeb
      ? ({
          // Soft --shadow-soft
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        } as object)
      : {}),
  },
  text: {
    color: theme.colors.foreground,
    fontFamily: isWeb ? "system-ui" : Fonts.sans,
    // Soft .user-b: 14px / 1.55
    fontSize: 14,
    lineHeight: Math.round(14 * 1.55),
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    overflowWrap: "anywhere",
    ...(isWeb ? { wordBreak: "break-word" as const } : {}),
  },
  imagePreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  attachmentPreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  imagePreviewSpacing: {
    marginBottom: theme.spacing[2],
  },
  // Soft quiet image chip.
  imagePill: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  imageThumbnail: {
    width: 48,
    height: 48,
  },
  imageThumbnailPlaceholder: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  structuredAttachmentPill: {
    maxWidth: 220,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  structuredAttachmentText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginRight: -theme.spacing[1],
  },
  trailingRow: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    ...(isWeb
      ? {
          position: "absolute" as const,
          top: "100%",
          right: 0,
          zIndex: 1,
        }
      : {}),
  },
  trailingRowHidden: isWeb ? { display: "none" as const } : { opacity: 0 },
  trailingRowVisible: {
    opacity: 1,
  },
  timestampText: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
}));

function UserMessageAttachmentThumbnail({ image }: { image: UserMessageImageAttachment }) {
  const uri = useAttachmentPreviewUrl(image);
  const imageSource = useMemo(() => ({ uri: uri ?? "" }), [uri]);
  if (!uri) {
    return <View style={userMessageStylesheet.imageThumbnailPlaceholder} />;
  }
  return <Image source={imageSource} style={userMessageStylesheet.imageThumbnail} />;
}

function getUserMessageAttachmentLabel(attachment: AgentAttachment): string {
  switch (attachment.type) {
    case "review": {
      const count = attachment.comments.length;
      return count === 1 ? "Review · 1 comment" : `Review · ${count} comments`;
    }
    case "github_pr":
      return `PR #${attachment.number}`;
    case "github_issue":
      return `Issue #${attachment.number}`;
    case "text":
      return attachment.title ?? "Text attachment";
    default:
      return "";
  }
}

function UserMessageImagePreviews({
  images,
  style,
}: {
  images: UserMessageImageAttachment[];
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {images.map((image) => (
        <View key={image.id} style={userMessageStylesheet.imagePill}>
          <UserMessageAttachmentThumbnail image={image} />
        </View>
      ))}
    </View>
  );
}

function UserMessageAttachmentPreviews({
  attachments,
  style,
}: {
  attachments: AgentAttachment[];
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {attachments.map((attachment, index) => (
        <View
          key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
          style={userMessageStylesheet.structuredAttachmentPill}
        >
          <Text style={userMessageStylesheet.structuredAttachmentText} numberOfLines={1}>
            {getUserMessageAttachmentLabel(attachment)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export const UserMessage = memo(function UserMessage({
  serverId,
  agentId,
  messageId,
  message,
  images,
  attachments,
  timestamp,
  capabilities,
  client,
  isFirstInGroup = true,
  isLastInGroup = true,
  disableOuterSpacing,
}: UserMessageProps) {
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const resolvedImages = images ?? EMPTY_USER_MESSAGE_IMAGES;
  const resolvedAttachments = attachments ?? EMPTY_USER_MESSAGE_ATTACHMENTS;
  const hasText = message.trim().length > 0;
  const hasImages = resolvedImages.length > 0;
  const hasAttachments = resolvedAttachments.length > 0;
  const showTrailingRow = hasText && (isCompact || isNative || isHovered);
  const formattedTimestamp = useMemo(
    () => formatMessageTimestamp(new Date(timestamp)),
    [timestamp],
  );
  const rewindMutation = useRewindAgentMutation({ serverId, agentId, client, messageId });

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const getMessageContent = useCallback(() => message, [message]);
  const handleRewind = useCallback(
    (input: { mode: RewindMode; rewoundText: string }) => {
      return rewindMutation.rewindAgent(input);
    },
    [rewindMutation],
  );

  const containerStyle = useMemo(
    () => [
      userMessageStylesheet.container,
      !resolvedDisableOuterSpacing && [
        isFirstInGroup ? userMessageStylesheet.containerFirstInGroup : null,
        isLastInGroup ? userMessageStylesheet.containerLastInGroup : null,
        !isFirstInGroup || !isLastInGroup ? userMessageStylesheet.containerSpacing : null,
      ],
    ],
    [resolvedDisableOuterSpacing, isFirstInGroup, isLastInGroup],
  );
  const imagePreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.imagePreviewContainer,
      hasText || hasAttachments ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasAttachments, hasText],
  );
  const attachmentPreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.attachmentPreviewContainer,
      hasText ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasText],
  );
  const trailingRowStyle = useMemo(
    () => [
      userMessageStylesheet.trailingRow,
      showTrailingRow
        ? userMessageStylesheet.trailingRowVisible
        : userMessageStylesheet.trailingRowHidden,
    ],
    [showTrailingRow],
  );

  return (
    <View style={containerStyle} testID="user-message">
      <View
        style={userMessageStylesheet.content}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <View style={userMessageStylesheet.bubble}>
          {hasImages ? (
            <UserMessageImagePreviews images={resolvedImages} style={imagePreviewContainerStyle} />
          ) : null}
          {hasAttachments ? (
            <UserMessageAttachmentPreviews
              attachments={resolvedAttachments}
              style={attachmentPreviewContainerStyle}
            />
          ) : null}
          {hasText ? (
            <Text selectable style={userMessageStylesheet.text}>
              {message}
            </Text>
          ) : null}
        </View>
        {hasText ? (
          <View style={trailingRowStyle} pointerEvents={showTrailingRow ? "auto" : "none"}>
            <Text style={userMessageStylesheet.timestampText}>{formattedTimestamp}</Text>
            {capabilities ? (
              <RewindMenu
                capabilities={capabilities}
                isPending={rewindMutation.isPending}
                rewoundText={message}
                onRewind={handleRewind}
              />
            ) : null}
            <TurnCopyButton
              getContent={getMessageContent}
              containerStyle={userMessageStylesheet.copyButton}
              accessibilityLabel={t("message.copyMessage")}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
});

interface AssistantTurnFooterProps {
  getContent: () => string;
}

const assistantTurnFooterStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginLeft: -theme.spacing[1],
  },
}));

/**
 * Footer rendered next to the copy button at the end of an assistant turn.
 * Deliberately shows only the copy action — the T3 duration label (and its
 * timestamp swap) was removed per product decision; the running state has its
 * own RunningTurnFooter.
 */
export const AssistantTurnFooter = memo(function AssistantTurnFooter({
  getContent,
}: AssistantTurnFooterProps) {
  return (
    <View style={assistantTurnFooterStylesheet.container}>
      <TurnCopyButton
        getContent={getContent}
        containerStyle={assistantTurnFooterStylesheet.copyButton}
      />
    </View>
  );
});

interface LiveElapsedProps {
  startedAt: Date;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Ticks every 100ms to render an elapsed duration. Isolated from parents so
 * only this component re-renders on each tick.
 */
export const LiveElapsed = memo(function LiveElapsed({
  startedAt,
  style,
  testID,
}: LiveElapsedProps) {
  const startedAtMs = startedAt.getTime();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAtMs));

  useEffect(() => {
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const handle = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 100);
    return () => clearInterval(handle);
  }, [startedAtMs]);

  return (
    <Text style={style} testID={testID}>
      {formatDuration(elapsedMs)}
    </Text>
  );
});

interface AssistantMessageProps {
  message: string;
  timestamp: number;
  workspaceRoot?: string;
  serverId?: string;
  agentId?: string;
  client?: DaemonClient | null;
  spacing?: "default" | "compactTop" | "compactBottom" | "compactBoth";
  /**
   * True while the agent turn is still running. Streaming code fences are
   * tokenized without polluting the shared highlight cache.
   */
  isStreaming?: boolean;
}

export const assistantMessageStylesheet = StyleSheet.create((theme) => ({
  // Soft .role-a: document-like reading, no bubble chrome.
  container: {
    paddingVertical: 0,
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  textSurface: {
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    minWidth: 0,
    width: "100%",
    maxWidth: WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH,
    ...(isWeb
      ? { boxShadow: "none" as const }
      : {
          shadowOpacity: 0,
          elevation: 0,
        }),
  },
  textSurfaceCompactTop: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    ...(isWeb
      ? { boxShadow: "none" as const }
      : {
          shadowOpacity: 0,
          elevation: 0,
        }),
  },
  textSurfaceCompactBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 0,
  },
  blockContainer: {
    minWidth: 0,
    maxWidth: "100%",
  },
  containerCompactTop: {
    paddingTop: 0,
  },
  containerCompactBottom: {
    paddingBottom: 0,
  },
  imageFrame: {
    width: "100%",
    minHeight: 160,
    marginHorizontal: -theme.spacing[1],
  },
  imageSurface: {
    width: "100%",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[2],
  },
  imageErrorText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
}));

const ASSISTANT_IMAGE_MIN_HEIGHT = 160;

const AssistantMarkdownResolvedImage = memo(function AssistantMarkdownResolvedImage({
  uri,
  alt,
  containerStyle,
  source,
  workspaceRoot,
  serverId,
}: {
  uri: string;
  alt?: string;
  containerStyle?: StyleProp<ViewStyle>;
  source: string;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const cachedMetadata = useMemo(
    () => getAssistantImageMetadata({ source, workspaceRoot, serverId }),
    [serverId, source, workspaceRoot],
  );
  const [loadState, setLoadState] = useState<AssistantImageLoadState>(() =>
    getAssistantImageLoadStateFromMetadata(cachedMetadata),
  );

  useEffect(() => {
    if (cachedMetadata) {
      setLoadState(getAssistantImageLoadStateFromMetadata(cachedMetadata));
      return () => {};
    }

    setLoadState({ status: "loading" });
    let cancelled = false;

    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        if (width > 0 && height > 0) {
          const metadata = setAssistantImageMetadata(
            { source, workspaceRoot, serverId },
            { width, height },
          );
          setLoadState({
            status: "ready",
            aspectRatio: metadata?.aspectRatio ?? width / height,
          });
        }
      },
      () => {
        if (cancelled) {
          return;
        }
        setLoadState({ status: "error" });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [cachedMetadata, serverId, source, uri, workspaceRoot]);

  const handleImageError = useCallback(() => {
    setLoadState({ status: "error" });
  }, []);
  const surfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      assistantMessageStylesheet.imageSurface,
      loadState.status === "ready"
        ? { aspectRatio: loadState.aspectRatio }
        : { height: ASSISTANT_IMAGE_MIN_HEIGHT },
    ],
    [loadState],
  );
  const frameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [assistantMessageStylesheet.imageFrame, containerStyle],
    [containerStyle],
  );
  const stateSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [surfaceStyle, assistantMessageStylesheet.imageState],
    [surfaceStyle],
  );
  const imageSource = useMemo(() => ({ uri }), [uri]);

  if (loadState.status !== "ready") {
    return (
      <View style={frameStyle}>
        <View style={stateSurfaceStyle}>
          {loadState.status === "loading" ? <ActivityIndicator size="small" /> : null}
          {loadState.status === "error" ? (
            <Text style={assistantMessageStylesheet.imageErrorText}>
              {t("files.imageUnavailable")}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={frameStyle}>
      <View style={surfaceStyle}>
        <Image
          source={imageSource}
          style={assistantMessageStylesheet.image}
          resizeMode="contain"
          accessibilityLabel={alt}
          onError={handleImageError}
        />
      </View>
    </View>
  );
});

function AssistantMarkdownImage({
  source,
  alt,
  hasLeadingContent,
  client,
  workspaceRoot,
  serverId,
}: {
  source: string;
  alt?: string;
  hasLeadingContent: boolean;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const resolution = useMemo(
    () => resolveAssistantImageSource({ source, workspaceRoot }),
    [source, workspaceRoot],
  );
  const dataImage = useMemo(() => parseImageDataUrl(source), [source]);
  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({
      marginTop: hasLeadingContent ? 16 : 0,
      marginBottom: 0,
    }),
    [hasLeadingContent],
  );

  const query = useQuery({
    queryKey: [
      "assistantMarkdownImage",
      serverId ?? "unknown-server",
      resolution?.kind === "file_rpc" ? resolution.cwd : null,
      resolution?.kind === "file_rpc" ? resolution.path : null,
    ],
    enabled: Boolean(client && resolution?.kind === "file_rpc"),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client || !resolution || resolution.kind !== "file_rpc") {
        return null;
      }

      const file = await client.readFile(resolution.cwd, resolution.path);
      if (file.kind !== "image") {
        throw new Error("Image preview unavailable.");
      }

      return await persistAttachmentFromBytes({
        id: createPreviewAttachmentId({
          mimeType: file.mime,
          path: file.path || resolution.path,
          size: file.size,
          modifiedAt: file.modifiedAt,
          contentLength: file.bytes.byteLength,
        }),
        bytes: file.bytes,
        mimeType: file.mime,
        fileName: getFileNameFromPath(file.path || resolution.path),
      });
    },
  });
  const dataImageQuery = useQuery({
    queryKey: ["assistantMarkdownDataImage", dataImage?.cacheKey ?? null],
    enabled: dataImage !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!dataImage) {
        return null;
      }

      return await persistAttachmentFromDataUrl({
        id: createPreviewAttachmentId({
          mimeType: dataImage.mimeType,
          contentLength: dataImage.base64.length,
        }),
        dataUrl: source,
        mimeType: dataImage.mimeType,
      });
    },
  });

  const fileAssetUri = useAttachmentPreviewUrl(query.data);
  const dataImageAssetUri = useAttachmentPreviewUrl(dataImageQuery.data);
  const directUri = resolution?.kind === "direct" && !dataImage ? resolution.uri : null;
  const resolvedUri = directUri ?? dataImageAssetUri ?? fileAssetUri ?? null;

  const stateFrameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      assistantMessageStylesheet.imageFrame,
      containerStyle,
      { height: ASSISTANT_IMAGE_MIN_HEIGHT },
      assistantMessageStylesheet.imageState,
    ],
    [containerStyle],
  );

  if (resolvedUri) {
    return (
      <AssistantMarkdownResolvedImage
        uri={resolvedUri}
        alt={alt}
        containerStyle={containerStyle}
        source={source}
        workspaceRoot={workspaceRoot}
        serverId={serverId}
      />
    );
  }

  if (query.isLoading || dataImageQuery.isLoading) {
    return (
      <View style={stateFrameStyle}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const errorText = resolveAssistantImageErrorText(query.error, dataImageQuery.error);

  return (
    <View style={stateFrameStyle}>
      <Text style={assistantMessageStylesheet.imageErrorText}>{errorText}</Text>
    </View>
  );
}

function resolveAssistantImageErrorText(fileError: unknown, dataError: unknown): string {
  if (fileError instanceof Error) return fileError.message;
  if (dataError instanceof Error) return dataError.message;
  return "Unable to load image preview.";
}

function getInlineCodeAutoLinkUrl(
  markdownParser: ReturnType<typeof MarkdownIt>,
  content: string,
): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const matches:
    | {
        index: number;
        lastIndex: number;
        url: string;
      }[]
    | null = markdownParser.linkify.match(trimmed);
  if (!matches || matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (!match || match.index !== 0 || match.lastIndex !== trimmed.length) {
    return null;
  }

  return match.url;
}

function getInlineCodeAutoLinkSource(input: {
  href: string;
  content: string;
}): AssistantFileLinkSource {
  return {
    href: input.href,
    text: input.content,
    markup: "linkify",
    sourceInfo: "auto",
  };
}

interface AssistantMarkdownAstNode extends ASTNode {
  sourceInfo?: string;
}

function getMarkdownLinkSource(node: AssistantMarkdownAstNode): AssistantFileLinkSource {
  return {
    href: typeof node.attributes?.href === "string" ? node.attributes.href : "",
    text: getMarkdownNodeText(node),
    markup: node.markup,
    sourceInfo: node.sourceInfo,
    sourceType: node.sourceType === "inline-code" ? "inline-code" : undefined,
  };
}

function getMarkdownNodeText(node: ASTNode): string {
  if (!node.children.length) {
    return node.content ?? "";
  }

  return node.children.map(getMarkdownNodeText).join("");
}

function nodeHasParentType(parent: unknown, type: string): boolean {
  if (Array.isArray(parent)) {
    return parent.some((entry) => entry?.type === type);
  }

  return (
    typeof parent === "object" &&
    parent !== null &&
    "type" in parent &&
    (parent as Record<"type", unknown>)["type"] === type
  );
}

const turnCopyButtonStylesheet = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "flex-start",
    padding: theme.spacing[2],
    paddingTop: 0,
    marginTop: theme.spacing[2],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));

interface TurnCopyButtonProps {
  getContent: () => string;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  copiedAccessibilityLabel?: string;
}

export const TurnCopyButton = memo(function TurnCopyButton({
  getContent,
  containerStyle,
  accessibilityLabel,
  copiedAccessibilityLabel,
}: TurnCopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const content = getContent();
    if (!content) {
      return;
    }

    await writeMarkdownToRichClipboard(content, getDefaultMarkdownClipboardEnvironment());
    setCopied(true);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [getContent]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const pressableStyle = useMemo(
    () => [turnCopyButtonStylesheet.container, containerStyle],
    [containerStyle],
  );

  return (
    <Pressable
      onPress={handleCopy}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={
        copied
          ? (copiedAccessibilityLabel ?? t("common.copied"))
          : (accessibilityLabel ?? t("message.copyTurn"))
      }
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? turnCopyButtonStylesheet.iconHoveredColor.color
          : turnCopyButtonStylesheet.iconColor.color;
        return copied ? (
          <Check size={16} color={iconColor} />
        ) : (
          <Copy size={16} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

interface AssistantMessageBlockContainerProps {
  block: string;
  marginBottom: number;
  children: ReactNode;
}

function AssistantMessageBlockContainer({
  block,
  marginBottom,
  children,
}: AssistantMessageBlockContainerProps) {
  const style = useMemo(() => (marginBottom > 0 ? { marginBottom } : undefined), [marginBottom]);
  const containerStyle = useMemo(() => [assistantMessageStylesheet.blockContainer, style], [style]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setAssistantMarkdownBlockHeight({ block, width, height });
    },
    [block],
  );
  return (
    <View style={containerStyle} onLayout={isWeb ? handleLayout : undefined}>
      {children}
    </View>
  );
}

interface MemoizedMarkdownBlockProps {
  text: string;
  rules: RenderRules;
  parser: MarkdownIt;
  onLinkPress: (url: string) => boolean;
}

const MemoizedMarkdownBlock = React.memo(function MemoizedMarkdownBlock({
  text,
  rules,
  parser,
  onLinkPress,
}: MemoizedMarkdownBlockProps) {
  // Soft stream .a prose via workbench scale (T3-aligned 14 / 23 / foregroundSoft).
  return (
    <MarkdownRenderer
      text={text}
      variant="workbench"
      enableHtmlish
      rules={rules}
      markdownit={parser}
      onLinkPress={onLinkPress}
      allowedImageHandlers={MARKDOWN_ALLOWED_IMAGE_HANDLERS}
      topLevelMaxExceededItem={MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM}
    />
  );
});

export const AssistantMessage = memo(function AssistantMessage({
  message,
  timestamp: _timestamp,
  workspaceRoot,
  serverId,
  agentId,
  client,
  spacing = "default",
  isStreaming = false,
}: AssistantMessageProps) {
  const markdownParser = useMemo(() => {
    const parser = MarkdownIt({ typographer: true, linkify: true });
    const defaultValidateLink = parser.validateLink.bind(parser);
    parser.validateLink = (url: string) => {
      if (url.trim().toLowerCase().startsWith("file://")) {
        return true;
      }

      return defaultValidateLink(url);
    };
    return parser;
  }, []);

  const fileLinkActions = useAssistantFileLinkActions();
  const handleMarkdownLinkPress = useStableEvent((url: string) => {
    fileLinkActions.open({ href: url }, "main");
    // react-native-markdown-display opens the link itself when this returns true.
    // We already handled it above, so return false to avoid duplicate opens.
    return false;
  });

  // Domain overlays only: generative UI fences, path-aware inline code, file
  // links, workspace images. Shared prose rules merge in via MarkdownRenderer.
  const markdownRules = useMemo<RenderRules>(() => {
    return {
      fence: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => {
        const generativeUi = getGenerativeUiFence(node.sourceInfo, node.content ?? "");
        if (generativeUi) {
          const genUiItem = buildGenerativeUiItem(node.key, generativeUi);
          return (
            <GenerativeUiRenderer
              key={node.key}
              item={genUiItem}
              serverId={serverId ?? ""}
              agentId={agentId ?? ""}
            />
          );
        }

        const generativeHtml = getGenerativeHtmlFence(node.sourceInfo, node.content ?? "");
        if (generativeHtml) {
          return (
            <GenerativeHtmlPreview
              key={node.key}
              html={generativeHtml.html}
              inheritedStyles={inheritedStyles}
              sourceTextStyle={styles.fence}
            />
          );
        }

        return (
          <HighlightedCodeBlock
            key={node.key}
            code={node.content}
            language={node.sourceInfo}
            inheritedStyles={inheritedStyles}
            textStyle={styles.fence}
            isStreaming={isStreaming}
          />
        );
      },
      code_inline: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => {
        const content = node.content ?? "";
        const isLinkedInlineCode = nodeHasParentType(parent, "link");
        const inlineCodeSource: AssistantFileLinkSource = {
          href: content,
          text: content,
          sourceType: "inline-code",
        };
        const shouldResolveInlinePath =
          !isLinkedInlineCode && fileLinkActions.canResolveFile(inlineCodeSource);

        if (shouldResolveInlinePath) {
          return (
            <AssistantInlineCodePathLink
              key={node.key}
              content={content}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            />
          );
        }

        const inlineCodeLinkUrl = getInlineCodeAutoLinkUrl(markdownParser, content);
        if (inlineCodeLinkUrl) {
          const source = getInlineCodeAutoLinkSource({
            href: inlineCodeLinkUrl,
            content,
          });
          return (
            <AssistantMarkdownCodeLink
              key={node.key}
              source={source}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            >
              {content}
            </AssistantMarkdownCodeLink>
          );
        }

        return (
          <MarkdownInheritedText
            key={node.key}
            inheritedStyles={inheritedStyles}
            textStyle={styles.code_inline}
            monoSurface
          >
            {content}
          </MarkdownInheritedText>
        );
      },
      link: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <AssistantMarkdownLink
          key={node.key}
          source={getMarkdownLinkSource(node)}
          style={styles.link}
        >
          {Children.map(children, (child) => {
            if (!isValidElement(child)) return child;
            const childProps = child.props as { style?: StyleProp<TextStyle> };
            return cloneElement(child, {
              style: [childProps.style, { color: styles.link.color }],
            } as Partial<{ style: StyleProp<TextStyle> }>);
          })}
        </AssistantMarkdownLink>
      ),
      image: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        _styles: MarkdownStyles,
      ) => {
        const paragraphNode = Array.isArray(parent)
          ? parent.find((ancestor) => ancestor?.type === "paragraph")
          : null;
        const paragraphChildren = Array.isArray(paragraphNode?.children)
          ? paragraphNode.children
          : [];
        const imageIndex = paragraphChildren.findIndex((child: ASTNode) => child?.key === node.key);
        const hasLeadingContent = imageIndex > 0;

        return (
          <AssistantMarkdownImage
            key={node.key}
            source={String(node.attributes?.src ?? "")}
            alt={typeof node.attributes?.alt === "string" ? node.attributes.alt : undefined}
            hasLeadingContent={hasLeadingContent}
            client={client}
            workspaceRoot={workspaceRoot}
            serverId={serverId}
          />
        );
      },
    };
  }, [agentId, client, fileLinkActions, isStreaming, markdownParser, serverId, workspaceRoot]);

  // During streaming the agent emits tokens rapidly and `message` changes on
  // every chunk. Re-parsing + re-rendering the whole markdown tree on each
  // token janks the main thread. `useDeferredValue` lets React keep showing
  // the previous parse while it prepares the next one in the background, so
  // high-frequency stream updates coalesce instead of blocking the UI.
  const deferredMessage = React.useDeferredValue(message);
  const displayMessage = useMemo(
    () => stripLeadingMarkdownHorizontalRule(deferredMessage),
    [deferredMessage],
  );
  const blocks = useMemo(() => splitMarkdownBlocks(displayMessage), [displayMessage]);
  const keyedBlocks = useMemo(
    () =>
      blocks.map((block, index) => {
        // Streaming-safe key: keying on a full content prefix made the last
        // block remount on every chunk (new prefix each token), re-highlighting
        // large code blocks and losing scroll state. The first line (code
        // fence, heading, first sentence) stabilizes after a few tokens, so
        // the dominant cases stop churning while keys stay unique per block.
        const firstLine = block.split("\n", 1)[0] ?? "";
        return { key: `${index}:${firstLine.slice(0, 32)}`, block };
      }),
    [blocks],
  );

  const assistantContainerStyle = useMemo(
    () => [
      assistantMessageStylesheet.container,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactBottom,
    ],
    [spacing],
  );
  const assistantSurfaceStyle = useMemo(
    () => [
      assistantMessageStylesheet.textSurface,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.textSurfaceCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.textSurfaceCompactBottom,
    ],
    [spacing],
  );

  return (
    <View testID="assistant-message" style={assistantContainerStyle}>
      <View testID="assistant-message-surface" style={assistantSurfaceStyle}>
        {keyedBlocks.map(({ key, block }, index) => (
          <AssistantMessageBlockContainer
            key={key}
            block={block}
            marginBottom={index < keyedBlocks.length - 1 ? 10 : 0}
          >
            <MemoizedMarkdownBlock
              text={block}
              rules={markdownRules}
              parser={markdownParser}
              onLinkPress={handleMarkdownLinkPress}
            />
          </AssistantMessageBlockContainer>
        ))}
      </View>
    </View>
  );
});

interface SpeakMessageProps {
  message: string;
  timestamp: number;
  disableOuterSpacing?: boolean;
}

const speakMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
  },
  containerSpacing: {
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  headerLabel: {
    fontFamily: Fonts.sans,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  text: {
    fontFamily: Fonts.sans,
    // Soft .a stream body: 14.5 / 1.65.
    fontSize: 14.5,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
}));

export const SpeakMessage = memo(function SpeakMessage({
  message,
  timestamp: _timestamp,
  disableOuterSpacing,
}: SpeakMessageProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const containerStyle = useMemo(
    () => [
      speakMessageStylesheet.container,
      !resolvedDisableOuterSpacing && speakMessageStylesheet.containerSpacing,
    ],
    [resolvedDisableOuterSpacing],
  );

  return (
    <View testID="speak-message" style={containerStyle}>
      <View style={speakMessageStylesheet.header}>
        <ThemedIconHost Icon={MicVocal} size={12} uniProps={foregroundMutedColorMapping} />
        <Text style={speakMessageStylesheet.headerLabel}>{t("message.spokenLabel")}</Text>
      </View>
      <Text style={speakMessageStylesheet.text}>{message}</Text>
    </View>
  );
});

interface ActivityLogProps {
  type: "system" | "info" | "success" | "error" | "artifact";
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  artifactId?: string;
  artifactType?: string;
  title?: string;
  onArtifactClick?: (artifactId: string) => void;
  disableOuterSpacing?: boolean;
}

// Activity log icon color mappings are passed through ThemedIconHost so only
// known SVG props reach the lucide leaf on web.
const activityLogSystemColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const activityLogInfoColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.blue[400],
});
const activityLogSuccessColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
});
const activityLogErrorColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
});
const activityLogArtifactColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.blue[300],
});

const activityLogStylesheet = StyleSheet.create((theme) => ({
  // Soft stream activity chip: quiet r12 card.
  pressable: {
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  pressableSpacing: {
    marginBottom: theme.spacing[1],
  },
  pressableActive: {
    opacity: 0.7,
  },
  // Soft activity washes: quiet Soft ink, not zinc/dark glass chips.
  systemBg: {
    backgroundColor: "rgba(20, 23, 31, 0.04)",
  },
  infoBg: {
    backgroundColor: "rgba(42, 108, 240, 0.1)",
  },
  successBg: {
    backgroundColor: "rgba(24, 163, 74, 0.1)",
  },
  errorBg: {},
  artifactBg: {
    backgroundColor: "rgba(42, 108, 240, 0.14)",
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconContainer: {
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
  messageText: {
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
  systemText: {
    color: theme.colors.foregroundMuted,
  },
  infoText: {
    color: theme.colors.palette.blue[400],
  },
  successText: {
    color: theme.colors.palette.green[400],
  },
  errorText: {
    color: theme.colors.palette.red[500],
  },
  artifactText: {
    color: theme.colors.palette.blue[300],
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.spacing[1],
  },
  detailsText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginRight: theme.spacing[1],
  },
  // Soft quiet metadata card.
  metadataContainer: {
    marginTop: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderRadius: 10,
    padding: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  metadataText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.code,
    fontFamily: Fonts.mono,
    lineHeight: 16,
  },
}));

export const ActivityLog = memo(function ActivityLog({
  type,
  message,
  timestamp: _timestamp,
  metadata,
  artifactId,
  artifactType,
  title,
  onArtifactClick,
  disableOuterSpacing,
}: ActivityLogProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isExpanded, setIsExpanded] = useState(false);

  const typeConfig = {
    system: {
      bg: activityLogStylesheet.systemBg,
      textStyle: activityLogStylesheet.systemText,
      Icon: Circle,
      iconUniProps: activityLogSystemColorMapping,
    },
    info: {
      bg: activityLogStylesheet.infoBg,
      textStyle: activityLogStylesheet.infoText,
      Icon: Info,
      iconUniProps: activityLogInfoColorMapping,
    },
    success: {
      bg: activityLogStylesheet.successBg,
      textStyle: activityLogStylesheet.successText,
      Icon: CheckCircle,
      iconUniProps: activityLogSuccessColorMapping,
    },
    error: {
      bg: activityLogStylesheet.errorBg,
      textStyle: activityLogStylesheet.errorText,
      Icon: XCircle,
      iconUniProps: activityLogErrorColorMapping,
    },
    artifact: {
      bg: activityLogStylesheet.artifactBg,
      textStyle: activityLogStylesheet.artifactText,
      Icon: FileText,
      iconUniProps: activityLogArtifactColorMapping,
    },
  };

  const config = typeConfig[type];
  const IconComponent = config.Icon;

  const handlePress = useCallback(() => {
    if (type === "artifact" && artifactId && onArtifactClick) {
      onArtifactClick(artifactId);
    } else if (metadata) {
      setIsExpanded((prev) => !prev);
    }
  }, [type, artifactId, onArtifactClick, metadata]);

  const displayMessage =
    type === "artifact" && artifactType && title ? `${artifactType}: ${title}` : message;

  const isInteractive = type === "artifact" || metadata;
  const pressableStyle = useMemo(
    () => [
      activityLogStylesheet.pressable,
      !resolvedDisableOuterSpacing && activityLogStylesheet.pressableSpacing,
      config.bg,
      isInteractive && activityLogStylesheet.pressableActive,
    ],
    [resolvedDisableOuterSpacing, config.bg, isInteractive],
  );
  const messageTextStyle = useMemo(
    () => [activityLogStylesheet.messageText, config.textStyle],
    [config.textStyle],
  );

  return (
    <Pressable onPress={handlePress} disabled={!isInteractive} style={pressableStyle}>
      <View style={activityLogStylesheet.content}>
        <View style={activityLogStylesheet.row}>
          <View style={activityLogStylesheet.iconContainer}>
            <ThemedIconHost Icon={IconComponent} size={16} uniProps={config.iconUniProps} />
          </View>
          <View style={activityLogStylesheet.textContainer}>
            <Text style={messageTextStyle} selectable>
              {displayMessage}
            </Text>
            {metadata && (
              <View style={activityLogStylesheet.detailsRow}>
                <Text style={activityLogStylesheet.detailsText}>
                  {t("message.activityDetails")}
                </Text>
                {isExpanded ? (
                  <ThemedIconHost
                    Icon={ChevronDown}
                    size={12}
                    uniProps={foregroundMutedColorMapping}
                  />
                ) : (
                  <ThemedIconHost
                    Icon={ChevronRight}
                    size={12}
                    uniProps={foregroundMutedColorMapping}
                  />
                )}
              </View>
            )}
          </View>
        </View>
        {isExpanded && metadata && (
          <View style={activityLogStylesheet.metadataContainer}>
            <Text style={activityLogStylesheet.metadataText}>
              {JSON.stringify(metadata, null, 2)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

interface CompactionMarkerProps {
  status: "loading" | "completed" | "failed";
  error?: string;
  trigger?: "auto" | "manual";
  preTokens?: number;
}

const compactionStylesheet = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "center",
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  text: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
}));

export const CompactionMarker = memo(function CompactionMarker({
  status,
  error,
  trigger,
  preTokens,
}: CompactionMarkerProps) {
  const { t } = useTranslation();
  const generatedLabel = getCompactionMarkerLabel({ status, error, trigger, preTokens });
  const label =
    generatedLabel === "Context compacted" ? t("message.compactedContext") : generatedLabel;

  return (
    <View style={compactionStylesheet.container}>
      <Text style={compactionStylesheet.text}>{label}</Text>
    </View>
  );
});

interface TodoListCardProps {
  items: TodoEntry[];
  disableOuterSpacing?: boolean;
  presentation?: "default" | "workbench";
}

interface TodoListItemRowProps {
  text: string;
  completed: boolean;
}

function TodoListItemRow({ text, completed }: TodoListItemRowProps) {
  const badgeStyle = useMemo(
    () => [
      todoListCardStylesheet.radioBadge,
      completed
        ? todoListCardStylesheet.radioBadgeComplete
        : todoListCardStylesheet.radioBadgeIncomplete,
    ],
    [completed],
  );
  const textStyle = useMemo(
    () => [todoListCardStylesheet.itemText, completed && todoListCardStylesheet.itemTextCompleted],
    [completed],
  );
  return (
    <View style={todoListCardStylesheet.itemRow}>
      <View style={badgeStyle}>
        {completed ? (
          <ThemedIconHost Icon={Check} size={12} uniProps={primaryForegroundColorMapping} />
        ) : null}
      </View>
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

const todoListCardStylesheet = StyleSheet.create((theme) => ({
  detailsWrapper: {
    padding: theme.spacing[2],
  },
  list: {
    gap: theme.spacing[1],
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  radioBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioBadgeIncomplete: {
    opacity: 0.55,
  },
  radioBadgeComplete: {
    opacity: 0.95,
  },
  itemText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
  },
  itemTextCompleted: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
  workbenchCard: {
    // Soft quiet card family (r14).
    width: "100%",
    maxWidth: 400,
    marginTop: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).chrome,
  },
  workbenchTitle: {
    marginBottom: 6,
    color: theme.colors.foreground,
    fontFamily: isWeb ? "system-ui" : Fonts.sans,
    fontSize: WORKBENCH_BODY_FONT_SIZE,
    lineHeight: WORKBENCH_BODY_LINE_HEIGHT,
    fontWeight: theme.fontWeight.semibold,
  },
  workbenchList: {
    gap: 3,
    paddingBottom: 3,
  },
  workbenchItemRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  workbenchCheck: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  workbenchItemText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontFamily: isWeb ? "system-ui" : Fonts.sans,
    fontSize: WORKBENCH_BODY_FONT_SIZE,
    lineHeight: WORKBENCH_BODY_LINE_HEIGHT,
  },
}));

export const TodoListCard = memo(function TodoListCard({
  items,
  disableOuterSpacing,
  presentation = "default",
}: TodoListCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const nextTask = useMemo(() => items.find((item) => !item.completed)?.text, [items]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const renderDetails = useCallback(() => {
    return (
      <View style={todoListCardStylesheet.detailsWrapper}>
        <View style={todoListCardStylesheet.list}>
          {items.length === 0 ? (
            <Text style={todoListCardStylesheet.emptyText}>{t("message.todoEmpty")}</Text>
          ) : (
            items.map((item) => (
              <TodoListItemRow key={item.text} text={item.text} completed={item.completed} />
            ))
          )}
        </View>
      </View>
    );
  }, [items, t]);

  if (presentation === "workbench") {
    return (
      <View style={todoListCardStylesheet.workbenchCard} testID="workbench-todo-card">
        <Text style={todoListCardStylesheet.workbenchTitle}>{t("message.todoWorkbenchTitle")}</Text>
        <View style={todoListCardStylesheet.workbenchList}>
          {items.map((item) => (
            // Known limitation: keying on item.text can collide if two todo
            // items share identical text. A stable id on TodoEntry (protocol
            // change) is the proper fix; tracked as a follow-up.
            <View key={item.text} style={todoListCardStylesheet.workbenchItemRow}>
              <View style={todoListCardStylesheet.workbenchCheck}>
                {item.completed ? (
                  <ThemedIconHost Icon={Check} size={10} uniProps={primaryForegroundColorMapping} />
                ) : null}
              </View>
              <Text style={todoListCardStylesheet.workbenchItemText}>{item.text}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <ExpandableBadge
      label="Tasks"
      secondaryLabel={nextTask}
      icon={CheckSquare}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      disableOuterSpacing={disableOuterSpacing}
    />
  );
});

interface ToolCallProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  badgeStyle?: StyleProp<ViewStyle>;
  badgePresentation?: "default" | "workbench";
  onInlineDetailsHoverChange?: (hovered: boolean) => void;
  onInlineDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenFilePath?: (filePath: string) => void;
}

export const ToolCall = memo(function ToolCall({
  toolName,
  args,
  result,
  error,
  status,
  detail,
  cwd,
  metadata,
  isLastInSequence = false,
  disableOuterSpacing,
  badgeStyle,
  badgePresentation = "default",
  onInlineDetailsHoverChange,
  onInlineDetailsExpandedChange,
  onOpenFilePath,
}: ToolCallProps) {
  const { openToolCall } = useToolCallSheet();
  const [isExpanded, setIsExpanded] = useState(false);

  const isMobile = useIsCompactFormFactor();

  const effectiveDetail = useMemo<ToolCallDetail | undefined>(() => {
    if (detail) {
      return detail;
    }
    if (args !== undefined || result !== undefined) {
      return {
        type: "unknown",
        input: args ?? null,
        output: result ?? null,
      };
    }
    return undefined;
  }, [detail, args, result]);

  const presentation = useMemo(
    () =>
      buildToolCallPresentation({
        toolName,
        status,
        error: error ?? null,
        detail: effectiveDetail,
        metadata,
        cwd,
        resolveIcon: resolveToolCallIcon,
      }),
    [toolName, status, error, effectiveDetail, metadata, cwd],
  );
  const handleOpenFile = useMemo(() => {
    const openFilePath = presentation.openFilePath;
    if (!openFilePath || !onOpenFilePath) {
      return undefined;
    }
    return () => onOpenFilePath(openFilePath);
  }, [presentation.openFilePath, onOpenFilePath]);

  const handleToggle = useCallback(() => {
    if (isMobile) {
      openToolCall({
        displayName: presentation.displayName,
        summary: presentation.summary,
        detail: effectiveDetail,
        errorText: presentation.errorText,
        icon: presentation.icon,
        showLoadingSkeleton: presentation.isLoadingDetails,
      });
    } else {
      setIsExpanded((prev) => !prev);
    }
  }, [
    isMobile,
    openToolCall,
    presentation.displayName,
    presentation.summary,
    presentation.errorText,
    presentation.icon,
    presentation.isLoadingDetails,
    effectiveDetail,
  ]);

  useEffect(() => {
    if (!onInlineDetailsHoverChange || isMobile || isExpanded) {
      return;
    }
    onInlineDetailsHoverChange(false);
  }, [isExpanded, isMobile, onInlineDetailsHoverChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return;
    }
    if (isMobile) {
      onInlineDetailsExpandedChange(false);
      return;
    }
    onInlineDetailsExpandedChange(isExpanded);
  }, [isExpanded, isMobile, onInlineDetailsExpandedChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return () => {};
    }
    return () => {
      onInlineDetailsExpandedChange(false);
    };
  }, [onInlineDetailsExpandedChange]);

  // Render inline details for desktop
  const renderDetails = useCallback(() => {
    if (isMobile) return null;
    return (
      <ToolCallDetailsContent
        detail={effectiveDetail}
        errorText={presentation.errorText}
        maxHeight={400}
        showLoadingSkeleton={presentation.isLoadingDetails}
      />
    );
  }, [isMobile, effectiveDetail, presentation.errorText, presentation.isLoadingDetails]);

  if (presentation.isPlan && effectiveDetail?.type === "plan") {
    return (
      <PlanCard
        text={effectiveDetail.text}
        testID="timeline-plan-card"
        disableOuterSpacing={disableOuterSpacing}
      />
    );
  }

  return (
    <ExpandableBadge
      testID="tool-call-badge"
      style={badgeStyle}
      presentation={badgePresentation}
      label={presentation.displayName}
      secondaryLabel={presentation.summary}
      icon={presentation.icon}
      isExpanded={!isMobile && isExpanded}
      onToggle={presentation.canOpenDetails ? handleToggle : undefined}
      onOpenFile={handleOpenFile}
      renderDetails={presentation.canOpenDetails && !isMobile ? renderDetails : undefined}
      isLoading={status === "running" || status === "executing"}
      isError={status === "failed"}
      isLastInSequence={isLastInSequence}
      disableOuterSpacing={disableOuterSpacing}
      onDetailHoverChange={onInlineDetailsHoverChange}
    />
  );
}, areToolCallPropsEqual);

function areToolCallPropsEqual(previous: ToolCallProps, next: ToolCallProps) {
  if (previous.toolName !== next.toolName) return false;
  if (previous.args !== next.args) return false;
  if (previous.result !== next.result) return false;
  if (previous.error !== next.error) return false;
  if (previous.status !== next.status) return false;
  if (previous.detail !== next.detail) return false;
  if (previous.cwd !== next.cwd) return false;
  if (previous.metadata !== next.metadata) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.badgeStyle !== next.badgeStyle) return false;
  if (previous.badgePresentation !== next.badgePresentation) return false;
  if (previous.onOpenFilePath !== next.onOpenFilePath) return false;
  return true;
}
