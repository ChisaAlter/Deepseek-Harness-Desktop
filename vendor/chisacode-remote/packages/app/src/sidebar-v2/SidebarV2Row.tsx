import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AlarmClock,
  AlarmClockOff,
  Check,
  CircleCheck,
  CircleDashed,
  GitBranch,
  Undo2,
} from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { sidebarV2ThreadKey, useSidebarV2Store } from "./store";
import {
  SidebarV2BulkMenu,
  type SidebarV2BulkMenuCallbacks,
  type SidebarV2BulkMenuCapabilities,
} from "./SidebarV2BulkMenu";
import {
  resolveSidebarV2TopStatus,
  shouldSidebarRowRecede,
  formatRelativeTimeLabel,
} from "./presentation";
import { snoozeWakeLabel } from "./snooze";
import type { SidebarV2Thread } from "./agent-adapter";
import {
  SidebarV2RowMenu,
  type SidebarV2MenuCallbacks,
  type SidebarV2MenuCapabilities,
} from "./SidebarV2Menu";

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const skyColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });
const amberColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const emeraldColorMapping = (theme: Theme) => ({ color: theme.colors.success });

/** Resolves the status label style for a top-status color. */
function statusLabelStyle(color: "sky" | "amber" | "indigo" | "red" | "emerald") {
  switch (color) {
    case "sky":
      return [styles.statusSlotLabel, styles.statusLabelSky];
    case "amber":
      return [styles.statusSlotLabel, styles.statusLabelAmber];
    case "red":
      return [styles.statusSlotLabel, styles.statusLabelRed];
    case "emerald":
      return [styles.statusSlotLabel, styles.statusLabelEmerald];
    case "indigo":
      return [styles.statusSlotLabel, styles.statusLabelIndigo];
  }
}

interface SidebarV2RowProps {
  thread: SidebarV2Thread;
  variant: "card" | "slim";
  variantAction: "settle" | "unsettle" | "unsnooze";
  isActive: boolean;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  isSnoozed: boolean;
  isSettled: boolean;
  isWoke: boolean;
  unseenCompletion: boolean;
  now: string;
  snoozeNow: string;
  canSnoozeThread: boolean;
  canSettleThread: boolean;
  projectLabel: string | null;
  onPress: () => void;
  onRename: (title: string) => void;
  onSettle: () => void;
  onUnsettle: () => void;
  onSnooze: (untilIso: string, whenLabel?: string) => void;
  onUnsnooze: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onCopyBranch: () => void;
  onMarkUnread: () => void;
  onRegenerateTitle: () => void;
  selectedCount?: number;
  bulkMenuCapabilities?: SidebarV2BulkMenuCapabilities;
  bulkMenuCallbacks?: SidebarV2BulkMenuCallbacks;
  onModSelect?: () => void;
  onRangeSelect?: () => void;
}

function StatusSlotIcon({ status }: { status: "working" | "woke" | "done" | null }) {
  if (status === "working") {
    return <ThemedIconHost Icon={CircleDashed} size={ICON_SIZE.xs} uniProps={skyColorMapping} />;
  }
  if (status === "woke") {
    return <ThemedIconHost Icon={AlarmClock} size={ICON_SIZE.xs} uniProps={amberColorMapping} />;
  }
  if (status === "done") {
    return <ThemedIconHost Icon={CircleCheck} size={ICON_SIZE.xs} uniProps={emeraldColorMapping} />;
  }
  return null;
}

function resolveStatusSlotIconStatus(
  label: string | undefined,
): "working" | "woke" | "done" | null {
  if (label === "Working") {
    return "working";
  }
  if (label === "Woke") {
    return "woke";
  }
  if (label === "Done") {
    return "done";
  }
  return null;
}

export function SidebarV2Row({
  thread,
  variant,
  variantAction,
  isActive,
  isSelected,
  isMultiSelectMode,
  isSnoozed,
  isSettled,
  isWoke,
  unseenCompletion,
  now,
  snoozeNow,
  canSnoozeThread,
  canSettleThread,
  projectLabel,
  onPress,
  onRename,
  onSettle,
  onUnsettle,
  onSnooze,
  onUnsnooze,
  onDelete,
  onCopyPath,
  onCopyBranch,
  onMarkUnread,
  onRegenerateTitle,
  selectedCount = 0,
  bulkMenuCapabilities,
  bulkMenuCallbacks,
  onModSelect,
  onRangeSelect,
}: SidebarV2RowProps) {
  const isCompact = useIsCompactFormFactor();
  void isCompact;
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(thread.title);
  const renameInputRef = useRef<TextInput | null>(null);
  const toggleSelected = useSidebarV2Store((state) => state.toggleThreadSelected);

  const handleStartRename = useCallback(() => {
    setDraftTitle(thread.title);
    setIsRenaming(true);
  }, [thread.title]);

  const { capabilities: menuCapabilities, callbacks: menuCallbacks } = useRowMenu({
    thread,
    variantAction,
    isSnoozed,
    isSettled,
    canSnoozeThread,
    canSettleThread,
    onSettle,
    onUnsettle,
    onSnooze,
    onUnsnooze,
    onStartRename: handleStartRename,
    onRegenerateTitle,
    onMarkUnread,
    onCopyPath,
    onCopyBranch,
    onDelete,
  });

  const status = useMemo(() => {
    if (thread.hasPendingApprovals) return "approval" as const;
    if (thread.hasPendingUserInput) return "input" as const;
    if (thread.status === "running" || thread.status === "initializing") return "working" as const;
    if (thread.status === "error" || thread.lastError) return "failed" as const;
    return "ready" as const;
  }, [thread]);

  const topStatus = useMemo(
    () =>
      resolveSidebarV2TopStatus({
        status,
        workingStartedAt: thread.latestUserMessageAt,
        woke: isWoke,
        unseenCompletion,
      }),
    [status, thread.latestUserMessageAt, isWoke, unseenCompletion],
  );

  const shouldRecede = useMemo(
    () =>
      shouldSidebarRowRecede({
        status,
        isUnread: unseenCompletion,
        isWoke,
        isActive,
        isSelected,
      }),
    [status, unseenCompletion, isWoke, isActive, isSelected],
  );

  const timeLabel = useMemo(
    () => formatRelativeTimeLabel(thread.lastActivityAt, new Date(now)),
    [thread.lastActivityAt, now],
  );

  const wakeLabel = useMemo(() => {
    if (isSnoozed && thread.snoozedUntil) {
      return snoozeWakeLabel(thread.snoozedUntil, { now: snoozeNow });
    }
    return null;
  }, [isSnoozed, thread.snoozedUntil, snoozeNow]);

  const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);

  const activateRow = useCallback(
    (modifiers?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => {
      const isMod = Boolean(modifiers?.metaKey || modifiers?.ctrlKey);
      const isShift = Boolean(modifiers?.shiftKey);
      if (isShift && onRangeSelect) {
        onRangeSelect();
        return;
      }
      if (isMod && onModSelect) {
        onModSelect();
        return;
      }
      if (isMultiSelectMode) {
        toggleSelected(threadKey);
        return;
      }
      onPress();
    },
    [isMultiSelectMode, onModSelect, onPress, onRangeSelect, threadKey, toggleSelected],
  );

  const handlePress = useCallback(
    (event?: GestureResponderEvent) => {
      // RNW 0.21 Pressable swallows a user-supplied onClick (its internal click
      // handler wins and only invokes onPress), so onPress is the single web
      // activation path; there is no double-firing to avoid. Modifier keys
      // arrive on nativeEvent for web mouse events; native taps have none.
      const native = event?.nativeEvent as
        | (GestureResponderEvent["nativeEvent"] & {
            metaKey?: boolean;
            ctrlKey?: boolean;
            shiftKey?: boolean;
          })
        | undefined;
      activateRow({
        metaKey: native?.metaKey,
        ctrlKey: native?.ctrlKey,
        shiftKey: native?.shiftKey,
      });
    },
    [activateRow],
  );

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const hoverProps = isWeb
    ? { onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }
    : {};
  const handleLongPress = useCallback(() => {
    toggleSelected(threadKey);
  }, [threadKey, toggleSelected]);
  const handleRenameKeyPress = useCallback((event: { nativeEvent: { key: string } }) => {
    if (event.nativeEvent.key === "Escape") {
      setIsRenaming(false);
    }
  }, []);

  const handleCommitRename = useCallback(() => {
    setIsRenaming(false);
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== thread.title) {
      onRename(nextTitle);
    }
  }, [draftTitle, onRename, thread.title]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
    }
  }, [isRenaming]);

  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => {
      const styleList: StyleProp<ViewStyle>[] = [styles.rowBase];
      if (variant === "card") {
        styleList.push(styles.card);
      } else {
        styleList.push(styles.slim);
      }
      if (isActive) {
        styleList.push(styles.rowActive);
      } else if (isSelected) {
        styleList.push(styles.rowSelected);
      }
      // Active/selected fill is stable chrome — hover must not recolor the row.
      if (!(isActive || isSelected) && (isHovered || hovered)) {
        styleList.push(styles.rowHovered);
      }
      if (shouldRecede) {
        styleList.push(styles.rowReceded);
      }
      if (!(isActive || isSelected) && pressed) {
        styleList.push(styles.rowPressed);
      }
      return styleList;
    },
    [isActive, isSelected, isHovered, shouldRecede, variant],
  );

  const renderCard = () => (
    <View style={styles.cardLines}>
      <View style={styles.cardLine1}>
        <Text style={styles.cardProjectLabel} numberOfLines={1}>
          {projectLabel ?? thread.projectName ?? "Local"}
        </Text>
        {topStatus ? (
          <View style={styles.statusSlot}>
            <StatusSlotIcon status={resolveStatusSlotIconStatus(topStatus.label)} />
            <Text style={statusLabelStyle(topStatus.color)}>{topStatus.label}</Text>
          </View>
        ) : (
          timeLabel && <Text style={styles.timeLabel}>{timeLabel}</Text>
        )}
      </View>
      <View style={styles.cardLine2}>
        {isRenaming ? (
          <TextInput
            ref={renameInputRef}
            style={styles.renameInput}
            value={draftTitle}
            onChangeText={setDraftTitle}
            onSubmitEditing={handleCommitRename}
            onBlur={handleCommitRename}
            onKeyPress={handleRenameKeyPress}
            selectTextOnFocus
          />
        ) : (
          <Text style={styles.cardTitle} numberOfLines={1}>
            {thread.title}
          </Text>
        )}
      </View>
      <View style={styles.cardLine3}>
        {thread.branch ? (
          <View style={styles.branchRow}>
            <ThemedIconHost
              Icon={GitBranch}
              size={ICON_SIZE.xs}
              uniProps={foregroundMutedColorMapping}
            />
            <Text style={styles.branchLabel} numberOfLines={1}>
              {thread.branch}
            </Text>
          </View>
        ) : (
          <View style={styles.branchSpacer} />
        )}
        <View style={styles.cardTrailing}>
          <Tooltip>
            <TooltipTrigger>
              <View style={styles.smallIconButton} onTouchEnd={handleStartRename}>
                <ThemedIconHost
                  Icon={Check}
                  size={ICON_SIZE.sm}
                  uniProps={foregroundMutedColorMapping}
                />
              </View>
            </TooltipTrigger>
            <TooltipContent>Rename</TooltipContent>
          </Tooltip>
        </View>
      </View>
    </View>
  );

  const renderSlim = () => (
    <View style={styles.slimLines}>
      <Text style={styles.slimTitle} numberOfLines={1}>
        {thread.title}
      </Text>
      <View style={styles.slimTrailing}>
        {wakeLabel ? <Text style={styles.wakeLabel}>{wakeLabel}</Text> : null}
        {isWoke ? (
          <View style={styles.wokePill}>
            <ThemedIconHost Icon={AlarmClock} size={ICON_SIZE.xs} uniProps={amberColorMapping} />
            <Text style={styles.wokePillText}>Woke</Text>
          </View>
        ) : null}
        {!wakeLabel && !isWoke && timeLabel ? (
          <Text style={styles.timeLabel}>{timeLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  const renderVariantAction = () => {
    if (variantAction === "unsnooze") {
      return (
        <Tooltip>
          <TooltipTrigger>
            <View style={styles.smallIconButton} onTouchEnd={onUnsnooze}>
              <ThemedIconHost
                Icon={AlarmClockOff}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent>Wake thread now</TooltipContent>
        </Tooltip>
      );
    }
    if (variantAction === "unsettle") {
      return (
        <Tooltip>
          <TooltipTrigger>
            <View style={styles.smallIconButton} onTouchEnd={onUnsettle}>
              <ThemedIconHost
                Icon={Undo2}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent>Un-settle thread</TooltipContent>
        </Tooltip>
      );
    }
    return null;
  };

  const threadTestId = `sidebar-v2-thread-${thread.id}`;
  return (
    <ContextMenu>
      {/*
        Keep the stable thread testID on both the outer wrapper and Pressable.
        Electron/RNW can collapse one of the layers depending on ContextMenu
        composition, so dual placement keeps Playwright locators stable.
      */}
      <View testID={threadTestId} collapsable={false} accessibilityLabel={threadTestId}>
        <ContextMenuTrigger>
          <Pressable
            style={rowStyle}
            onPress={handlePress}
            onLongPress={handleLongPress}
            testID={threadTestId}
            aria-selected={isActive}
            accessibilityLabel={
              thread.projectName ? `${thread.projectName}: ${thread.title}` : thread.title
            }
            {...hoverProps}
          >
            {variant === "card" ? renderCard() : renderSlim()}
            {renderVariantAction()}
          </Pressable>
        </ContextMenuTrigger>
      </View>
      {selectedCount > 1 && isSelected && bulkMenuCapabilities && bulkMenuCallbacks ? (
        <SidebarV2BulkMenu
          count={selectedCount}
          capabilities={bulkMenuCapabilities}
          callbacks={bulkMenuCallbacks}
        />
      ) : (
        <SidebarV2RowMenu
          thread={thread}
          capabilities={menuCapabilities}
          callbacks={menuCallbacks}
        />
      )}
    </ContextMenu>
  );
}

/** Capabilities and callbacks derived from props for the row's context menu. */
function useRowMenu(input: {
  thread: SidebarV2Thread;
  variantAction: "settle" | "unsettle" | "unsnooze";
  isSnoozed: boolean;
  isSettled: boolean;
  canSnoozeThread: boolean;
  canSettleThread: boolean;
  onSettle: () => void;
  onUnsettle: () => void;
  onSnooze: (untilIso: string, whenLabel?: string) => void;
  onUnsnooze: () => void;
  onStartRename: () => void;
  onRegenerateTitle: () => void;
  onMarkUnread: () => void;
  onCopyPath: () => void;
  onCopyBranch: () => void;
  onDelete: () => void;
}): { capabilities: SidebarV2MenuCapabilities; callbacks: SidebarV2MenuCallbacks } {
  const capabilities: SidebarV2MenuCapabilities = {
    canSnooze: input.canSnoozeThread,
    canSettle: input.canSettleThread,
    canUnsettle: input.isSettled,
    canUnsnooze: input.isSnoozed,
    isSnoozed: input.isSnoozed,
    isSettled: input.isSettled,
  };
  const callbacks: SidebarV2MenuCallbacks = {
    onSettle: input.onSettle,
    onUnsettle: input.onUnsettle,
    onSnooze: (preset) => input.onSnooze(preset.snoozedUntil, preset.whenLabel),
    onUnsnooze: input.onUnsnooze,
    onRename: input.onStartRename,
    onRegenerateTitle: input.onRegenerateTitle,
    onMarkUnread: input.onMarkUnread,
    onCopyPath: input.onCopyPath,
    onCopyBranch: input.onCopyBranch,
    onDelete: input.onDelete,
  };
  return { capabilities, callbacks };
}

const styles = StyleSheet.create((theme) => ({
  rowBase: {
    width: "100%",
    borderRadius: theme.borderRadius.md,
    ...(isWeb
      ? ({
          cursor: "pointer",
          outlineWidth: 0,
          userSelect: "none",
        } as object)
      : {}),
  },
  card: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 78,
    justifyContent: "center",
  },
  slim: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[0.5],
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowActive: {
    backgroundColor: theme.colors.surface3,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface0,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowReceded: {
    opacity: 0.55,
  },
  rowPressed: {
    opacity: 0.8,
  },
  cardLines: {
    gap: 3,
  },
  cardLine1: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  cardProjectLabel: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  statusSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusSlotLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  statusLabelSky: {
    color: theme.colors.accentBright,
  },
  statusLabelAmber: {
    color: theme.colors.statusWarning,
  },
  statusLabelRed: {
    color: theme.colors.destructive,
  },
  statusLabelEmerald: {
    color: theme.colors.success,
  },
  statusLabelIndigo: {
    color: theme.colors.accent,
  },
  timeLabel: {
    fontSize: 12,
    color: theme.colors.foregroundFaint,
  },
  cardLine2: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  renameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardLine3: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  branchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  branchSpacer: {
    flex: 1,
  },
  branchLabel: {
    fontSize: 12,
    color: theme.colors.foregroundFaint,
  },
  cardTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  smallIconButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  slimLines: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  slimTitle: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.foreground,
  },
  slimTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  wakeLabel: {
    fontSize: 12,
    color: theme.colors.statusWarning,
  },
  wokePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.statusWarningBg,
  },
  wokePillText: {
    fontSize: 11,
    color: theme.colors.statusWarning,
    fontWeight: "500",
  },
}));
