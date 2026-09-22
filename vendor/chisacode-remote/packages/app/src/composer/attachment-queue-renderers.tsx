import { useCallback, useMemo, type ReactElement } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowUp, CircleDot, GitPullRequest, Pencil } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import type { GitHubSearchItem } from "@chisacode/protocol/messages";

import { AttachmentPill } from "@/components/attachment-pill";
import { ComboboxItem } from "@/components/ui/combobox";
import type { ComposerAttachment } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import type { QueuedComposerMessage } from "@/composer/actions";
import {
  formatGithubItemLabel,
  resolveGithubItemKindLabel,
} from "@/composer/attachment-queue-model";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface RenderAttachmentTrayArgs {
  selectedAttachments: ComposerAttachment[];
  isComposerLocked: boolean;
  handleOpenAttachment: (attachment: ComposerAttachment) => void;
  handleRemoveAttachment: (index: number) => void;
}

interface RenderQueueTrackArgs {
  queuedMessages: readonly QueuedComposerMessage[];
  handleEditQueuedMessage: (id: string) => void;
  handleSendQueuedNow: (id: string) => Promise<void>;
}

interface RenderComposerAttachmentPillArgs {
  attachment: ComposerAttachment;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

interface QueuedMessageRowProps {
  item: QueuedComposerMessage;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
}

interface ImageAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "image" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

interface GithubAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "github_pr" | "github_issue" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

interface GithubPickerOptionProps {
  label: string;
  testID: string;
  active: boolean;
  selected: boolean;
  item: GitHubSearchItem;
  onToggle: (item: GitHubSearchItem) => void;
}

export function renderAttachmentTray(args: RenderAttachmentTrayArgs): ReactElement | null {
  const { selectedAttachments, isComposerLocked, handleOpenAttachment, handleRemoveAttachment } =
    args;
  if (selectedAttachments.length === 0) return null;
  return (
    <View style={styles.attachmentTray} testID="composer-attachment-tray">
      {selectedAttachments.map((attachment, index) =>
        renderComposerAttachmentPill({
          attachment,
          index,
          disabled: isComposerLocked,
          onOpen: handleOpenAttachment,
          onRemove: handleRemoveAttachment,
        }),
      )}
    </View>
  );
}

export function renderQueueTrack(args: RenderQueueTrackArgs): ReactElement | null {
  const { queuedMessages, handleEditQueuedMessage, handleSendQueuedNow } = args;
  if (queuedMessages.length === 0) return null;
  return (
    <View style={styles.queueTrack}>
      {queuedMessages.map((item) => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          onEdit={handleEditQueuedMessage}
          onSendNow={handleSendQueuedNow}
        />
      ))}
    </View>
  );
}

function renderComposerAttachmentPill(args: RenderComposerAttachmentPillArgs): ReactElement {
  const { attachment, index, disabled, onOpen, onRemove } = args;
  if (attachment.kind === "image") {
    return (
      <ImageAttachmentPill
        key={attachment.metadata.id}
        attachment={attachment}
        index={index}
        disabled={disabled}
        onOpen={onOpen}
        onRemove={onRemove}
      />
    );
  }
  if (composerWorkspaceAttachment.is(attachment)) {
    return composerWorkspaceAttachment.renderPill({
      attachment,
      index,
      disabled,
      onOpen,
      onRemove,
    });
  }
  return (
    <GithubAttachmentPill
      key={`${attachment.item.kind}:${attachment.item.number}`}
      attachment={attachment}
      index={index}
      disabled={disabled}
      onOpen={onOpen}
      onRemove={onRemove}
    />
  );
}

function QueuedMessageRow({ item, onEdit, onSendNow }: QueuedMessageRowProps) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => {
    onEdit(item.id);
  }, [onEdit, item.id]);
  const handleSendNow = useCallback(() => {
    onSendNow(item.id);
  }, [onSendNow, item.id]);
  return (
    <View style={styles.queueItem}>
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={t("composer.editQueuedMessage")}
          accessibilityRole="button"
        >
          <ThemedIconHost Icon={Pencil} size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={QUEUE_SEND_BUTTON_STYLE}
          accessibilityLabel={t("composer.sendQueuedMessageNow")}
          accessibilityRole="button"
        >
          <ThemedIconHost
            Icon={ArrowUp}
            size={ICON_SIZE.sm}
            uniProps={iconAccentForegroundMapping}
          />
        </Pressable>
      </View>
    </View>
  );
}

function ImageAttachmentThumbnail({
  attachment,
}: {
  attachment: ImageAttachmentPillProps["attachment"];
}) {
  const uri = useAttachmentPreviewUrl(attachment.metadata);
  const source = useMemo(() => ({ uri: uri ?? "" }), [uri]);
  if (!uri) {
    return <View style={styles.imageThumbnailPlaceholder} />;
  }
  return <Image source={source} style={styles.imageThumbnail} />;
}

function ImageAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: ImageAttachmentPillProps) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-image-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={t("composer.openImageAttachment")}
      removeAccessibilityLabel={t("composer.removeImageAttachment")}
      disabled={disabled}
    >
      <ImageAttachmentThumbnail attachment={attachment} />
    </AttachmentPill>
  );
}

function GithubAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: GithubAttachmentPillProps) {
  const { t } = useTranslation();
  const item = attachment.item;
  const kindLabel = resolveGithubItemKindLabel(item.kind);
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-github-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={t("composer.openGithubItem", {
        kind: kindLabel,
        number: item.number,
      })}
      removeAccessibilityLabel={t("composer.removeGithubItem", {
        kind: kindLabel,
        number: item.number,
      })}
      disabled={disabled}
    >
      <View style={styles.githubPillBody}>
        <View style={styles.githubPillIcon}>
          {item.kind === "pr" ? (
            <ThemedIconHost
              Icon={GitPullRequest}
              size={ICON_SIZE.sm}
              uniProps={iconForegroundMutedMapping}
            />
          ) : (
            <ThemedIconHost
              Icon={CircleDot}
              size={ICON_SIZE.sm}
              uniProps={iconForegroundMutedMapping}
            />
          )}
        </View>
        <Text style={styles.githubPillText} numberOfLines={1}>
          {formatGithubItemLabel(item)}
        </Text>
      </View>
    </AttachmentPill>
  );
}

export function GithubPickerOption({
  label,
  testID,
  active,
  selected,
  item,
  onToggle,
}: GithubPickerOptionProps) {
  const handlePress = useCallback(() => {
    onToggle(item);
  }, [onToggle, item]);
  const leadingSlot = useMemo(
    () =>
      item.kind === "pr" ? (
        <ThemedIconHost
          Icon={GitPullRequest}
          size={ICON_SIZE.sm}
          uniProps={iconForegroundMutedMapping}
        />
      ) : (
        <ThemedIconHost
          Icon={CircleDot}
          size={ICON_SIZE.sm}
          uniProps={iconForegroundMutedMapping}
        />
      ),
    [item.kind],
  );
  return (
    <ComboboxItem
      testID={testID}
      label={label}
      selected={selected}
      active={active}
      onPress={handlePress}
      leadingSlot={leadingSlot}
    />
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  attachmentTray: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    // Soft pen-bar: sit with textarea horizontal pad (16), slight top lead.
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  imageThumbnail: {
    width: 32,
    height: 32,
  },
  imageThumbnailPlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  githubPillBody: {
    minHeight: 32,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  githubPillIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  githubPillText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  queueTrack: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  queueItem: {
    // Soft quiet chip row (r10 session/set-item family).
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderRadius: 10,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  queueText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
})) as unknown as Record<string, object>;

const QUEUE_SEND_BUTTON_STYLE = [styles.queueActionButton, styles.queueSendButton];

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
