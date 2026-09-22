import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ChevronDown, Info, MoreVertical } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useToast } from "@/contexts/toast-context";
import type { GitAction, GitActions } from "@/git/policy";
import { useTranslation } from "react-i18next";
import { type Theme } from "@/styles/theme";

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface GitActionsSplitButtonProps {
  gitActions: GitActions;
  hideLabels?: boolean;
  /**
   * When policy has no primary action (clean, in-sync branch), still reserve the
   * primary chip so the topbar Git slot never collapses next to Open.
   */
  idleLabel?: string;
  /**
   * Desktop topbar hosts BranchSwitcher for the idle branch name. Hide the
   * disabled fake-branch chip so that slot is actually clickable.
   */
  hideIdlePrimary?: boolean;
  loading?: boolean;
}

interface GitActionMenuItemProps {
  action: GitAction;
  onSelect: (action: GitAction) => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  needsSeparator?: boolean;
  showSeparator?: boolean;
  closeOnSelect?: boolean;
}

function GitActionMenuItem({
  action,
  onSelect,
  archiveShortcutKeys,
  needsSeparator,
  showSeparator,
  closeOnSelect,
}: GitActionMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(action), [onSelect, action]);
  const trailing = useMemo(
    () =>
      action.id === "archive-worktree" && archiveShortcutKeys ? (
        <Shortcut chord={archiveShortcutKeys} />
      ) : undefined,
    [action.id, archiveShortcutKeys],
  );
  return (
    <View>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={`changes-menu-${action.id}`}
        leading={action.icon}
        trailing={trailing}
        disabled={action.disabled}
        muted={Boolean(action.unavailableMessage)}
        status={action.status}
        pendingLabel={action.pendingLabel}
        successLabel={action.successLabel}
        closeOnSelect={closeOnSelect}
        onSelect={handleSelect}
      >
        {action.label}
      </DropdownMenuItem>
    </View>
  );
}

function resolveGitActionDisplayLabel(action: GitAction): string {
  if (action.status === "pending") return action.pendingLabel;
  if (action.status === "success") return action.successLabel;
  return action.label;
}

function resolvePrimaryChipState(input: {
  primary: GitAction | null;
  loading: boolean;
  idleLabel: string;
  checkingLabel: string;
  hideIdlePrimary?: boolean;
}): {
  showPrimaryChip: boolean;
  primaryDisabled: boolean;
  primaryIsPending: boolean;
  primaryLabel: string;
  primaryAccessibilityLabel: string;
  canPressPrimary: boolean;
} {
  const { primary, loading, idleLabel, checkingLabel, hideIdlePrimary = false } = input;
  const showIdlePrimary = !primary && !loading && !hideIdlePrimary;
  const primaryDisabled = primary ? primary.disabled : true;
  const primaryIsPending = primary?.status === "pending" || loading;
  let primaryLabel = idleLabel;
  if (primary) {
    primaryLabel = resolveGitActionDisplayLabel(primary);
  } else if (loading) {
    primaryLabel = checkingLabel;
  }
  return {
    showPrimaryChip: Boolean(primary) || showIdlePrimary || loading,
    primaryDisabled,
    primaryIsPending,
    primaryLabel,
    primaryAccessibilityLabel: primary?.label ?? idleLabel,
    canPressPrimary: Boolean(primary) && !primaryDisabled,
  };
}

function GitPrimarySplit({
  primary,
  secondary,
  hideLabels,
  loading,
  idleLabel,
  hideIdlePrimary = false,
  onSelect,
  archiveShortcutKeys,
}: {
  primary: GitAction | null;
  secondary: GitAction[];
  hideLabels?: boolean;
  loading: boolean;
  idleLabel: string;
  hideIdlePrimary?: boolean;
  onSelect: (action: GitAction) => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}) {
  const { t } = useTranslation();
  const chip = resolvePrimaryChipState({
    primary,
    loading,
    idleLabel,
    checkingLabel: t("git.checkingRepository"),
    hideIdlePrimary,
  });

  const primaryPressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.splitButtonPrimary,
      (Boolean(hovered) || pressed) && !chip.primaryDisabled && styles.splitButtonPrimaryHovered,
      chip.primaryDisabled && styles.splitButtonPrimaryDisabled,
    ],
    [chip.primaryDisabled],
  );

  const caretTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonCaret,
      (hovered || pressed || open) && styles.splitButtonCaretHovered,
    ],
    [],
  );

  const handlePrimaryPress = useCallback(() => {
    if (!primary) return;
    onSelect(primary);
  }, [onSelect, primary]);

  const primaryAccessibilityState = useMemo(
    () => ({ disabled: !chip.canPressPrimary }),
    [chip.canPressPrimary],
  );

  if (!chip.showPrimaryChip && secondary.length === 0) {
    return null;
  }

  return (
    <View style={styles.splitButton}>
      {chip.showPrimaryChip ? (
        <Pressable
          testID="changes-primary-cta"
          style={primaryPressableStyle}
          onPress={handlePrimaryPress}
          disabled={!chip.canPressPrimary}
          accessibilityRole="button"
          accessibilityLabel={chip.primaryAccessibilityLabel}
          accessibilityState={primaryAccessibilityState}
        >
          <View style={styles.splitButtonContent}>
            {chip.primaryIsPending ? (
              <ThemedActivityIndicator
                size="small"
                style={styles.splitButtonSpinnerOnly}
                uniProps={foregroundColorMapping}
              />
            ) : (
              primary?.icon
            )}
            {!hideLabels ? <Text style={styles.splitButtonText}>{chip.primaryLabel}</Text> : null}
          </View>
        </Pressable>
      ) : null}
      {secondary.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="changes-primary-cta-caret"
            style={caretTriggerStyle}
            accessibilityRole="button"
            accessibilityLabel={t("git.moreOptions")}
          >
            <ThemedIconHost Icon={ChevronDown} size={16} uniProps={foregroundMutedColorMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
            {secondary.map((action, index) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={onSelect}
                archiveShortcutKeys={archiveShortcutKeys}
                needsSeparator={action.startsGroup}
                showSeparator={index > 0}
                closeOnSelect={
                  action.status === "idle" && action.id === "pr" && action.label === "View PR"
                }
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

export function GitActionsSplitButton({
  gitActions,
  hideLabels,
  idleLabel,
  hideIdlePrimary = false,
  loading = false,
}: GitActionsSplitButtonProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const archiveShortcutKeys = useShortcutKeys("archive-worktree");
  const resolvedIdleLabel = idleLabel ?? t("git.actionUpToDate");

  const unavailableToastIcon = useMemo(
    () => <ThemedIconHost Icon={Info} size={16} uniProps={foregroundColorMapping} />,
    [],
  );

  const handleActionSelect = useCallback(
    (action: GitAction) => {
      if (action.unavailableMessage) {
        toast.show(action.unavailableMessage, {
          durationMs: 3200,
          icon: unavailableToastIcon,
        });
        return;
      }
      action.handler();
    },
    [toast, unavailableToastIcon],
  );

  const overflowMenuButtonStyle = useMemo(() => [styles.iconButton, styles.overflowMenuButton], []);

  return (
    <View style={styles.row} testID="git-actions-split-button">
      <GitPrimarySplit
        primary={gitActions.primary}
        secondary={gitActions.secondary}
        hideLabels={hideLabels}
        loading={loading}
        idleLabel={resolvedIdleLabel}
        hideIdlePrimary={hideIdlePrimary}
        onSelect={handleActionSelect}
        archiveShortcutKeys={archiveShortcutKeys}
      />
      {gitActions.menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="changes-overflow-menu"
            hitSlop={8}
            style={overflowMenuButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("git.moreActions")}
          >
            <ThemedIconHost Icon={MoreVertical} size={16} uniProps={foregroundMutedColorMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} testID="changes-overflow-content">
            {gitActions.menu.map((action) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={handleActionSelect}
                closeOnSelect={false}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
    ...theme.shadow.sm,
  },
  splitButtonPrimary: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
    position: "relative",
  },
  splitButtonPrimaryHovered: {
    backgroundColor: theme.colors.surface1,
  },
  splitButtonPrimaryDisabled: {
    opacity: 0.6,
  },
  // Soft split control label: 12.5 meta.
  splitButtonText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  splitButtonSpinnerOnly: {
    transform: [{ scale: 0.8 }],
  },
  splitButtonCaret: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  splitButtonCaretHovered: {
    backgroundColor: theme.colors.surface1,
  },
  // Soft .top-tools .icon-btn: 32 r10.
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  overflowMenuButton: {
    marginRight: -theme.spacing[2],
  },
}));
