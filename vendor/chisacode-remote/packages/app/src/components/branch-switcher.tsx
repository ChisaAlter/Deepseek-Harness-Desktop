import { useCallback, useMemo, useRef } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Combobox, ComboboxItem } from "@/components/ui/combobox";
import type { ComboboxProps } from "@/components/ui/combobox";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";
import { resolveBranchPickerEmptyText } from "@/screens/new-workspace-branch-picker";
import { ScreenTitle } from "@/components/headers/screen-title";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";

// Bake color into mappers. On web, withUnistyles merges call-site props onto the
// child, so passing `uniProps` leaks onto lucide/DOM nodes and triggers:
// "React does not recognize the `uniProps` prop on a DOM element".
const ThemedGitBranch = withUnistyles(GitBranch, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedChevronDown = withUnistyles(ChevronDown, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface BranchSwitcherProps {
  currentBranchName: string | null;
  title: string;
  serverId: string;
  workspaceId: string;
  isGitCheckout: boolean;
  /**
   * Soft desktop topbar uses a compact `.ctx` pill; default keeps the mobile/title row look.
   */
  presentation?: "default" | "soft-pill";
}

export function BranchSwitcher({
  currentBranchName,
  title,
  serverId,
  workspaceId,
  isGitCheckout,
  presentation = "default",
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();
  const isSoftPill = presentation === "soft-pill";

  const { branchOptions, isFetching, isOpen, setIsOpen, handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    currentBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const titleContent = isSoftPill ? (
    // Soft ctx pill labels the branch only — session title owns workspace-header-title.
    <Text style={styles.softPillText} numberOfLines={1} testID="workspace-header-branch-label">
      {title}
    </Text>
  ) : (
    <View style={styles.titleRow}>
      {isGitCheckout ? <ThemedGitBranch size={14} /> : null}
      <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
    </View>
  );

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);
  const pickerEmptyText = resolveBranchPickerEmptyText({
    hasBranchOptions: branchOptions.length > 0,
    branchesFetching: isFetching,
    searchingLabel: t("workspace.searching"),
    noMatchLabel: t("branches.empty"),
  });

  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      isSoftPill ? styles.softPillTrigger : styles.branchSwitcherTrigger,
      (Boolean(hovered) || pressed) &&
        (isSoftPill ? styles.softPillTriggerHovered : styles.branchSwitcherTriggerHovered),
    ],
    [isSoftPill],
  );

  const branchLeadingSlot = useMemo(() => <ThemedGitBranch size={14} />, []);

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={branchLeadingSlot}
      />
    ),
    [branchLeadingSlot],
  );

  if (!currentBranchName) {
    return (
      <View style={isSoftPill ? styles.softPillTrigger : styles.branchSwitcherTrigger}>
        {titleContent}
      </View>
    );
  }

  return (
    <View ref={anchorRef} collapsable={false}>
      <Pressable
        testID="workspace-header-branch-switcher"
        onPress={handleOpen}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("branches.currentBranchLabel", { branch: currentBranchName })}
      >
        {titleContent}
        {!isCompact || isSoftPill ? <ThemedChevronDown size={12} /> : null}
      </Pressable>
      <Combobox
        options={branchOptions}
        value={currentBranchName}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branches.placeholder")}
        searchPlaceholder={t("branches.searchPlaceholder")}
        emptyText={pickerEmptyText}
        title={t("branches.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  branchSwitcherTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    marginLeft: {
      xs: -theme.spacing[2],
      md: 0,
    },
    paddingVertical: {
      xs: 0,
      md: theme.spacing[1],
    },
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
    flexShrink: 1,
  },
  branchSwitcherTriggerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    overflow: "hidden",
  },
  // Soft .ctx pill for desktop topbar branch control.
  softPillTrigger: {
    height: 30,
    maxWidth: 130,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  softPillTriggerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  softPillText: {
    // design --text-2 for Soft .ctx
    color: theme.colors.foregroundSubtleText,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
}));
