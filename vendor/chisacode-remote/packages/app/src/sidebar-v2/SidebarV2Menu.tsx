import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { resolveSnoozePresets, type SnoozePreset } from "./snooze";
import type { SidebarV2Thread } from "./agent-adapter";

/** Capability flags the sidebar knows about for a thread. */
export interface SidebarV2MenuCapabilities {
  canSnooze: boolean;
  canSettle: boolean;
  canUnsettle: boolean;
  canUnsnooze: boolean;
  isSnoozed: boolean;
  isSettled: boolean;
}

/** Callbacks invoked by the context menu. */
export interface SidebarV2MenuCallbacks {
  onSettle: () => void;
  onUnsettle: () => void;
  onSnooze: (preset: SnoozePreset) => void;
  onUnsnooze: () => void;
  onRename: () => void;
  onRegenerateTitle: () => void;
  onMarkUnread: () => void;
  onCopyPath: () => void;
  onCopyBranch: () => void;
  onDelete: () => void;
}

/** Renders the full T3 v2 single-row context menu inside ContextMenuContent. */
export function SidebarV2RowMenu({
  thread,
  capabilities,
  callbacks,
}: {
  thread: SidebarV2Thread;
  capabilities: SidebarV2MenuCapabilities;
  callbacks: SidebarV2MenuCallbacks;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const snoozePresets = resolveSnoozePresets(new Date());

  const handleSnoozePreset = useCallback(
    (preset: SnoozePreset) => {
      callbacks.onSnooze(preset);
      toast.show(t("sidebarV2.snoozedUntil", { when: snoozeWakeDescriptionLocal(preset) }));
    },
    [callbacks, t, toast],
  );

  return (
    <ContextMenuContent mobileMode="sheet" minWidth={220}>
      {capabilities.isSettled ? (
        <ContextMenuItem
          testID="sidebar-v2-menu-unsettle"
          onSelect={callbacks.onUnsettle}
          disabled={!capabilities.canUnsettle}
        >
          {t("sidebarV2.unsettle")}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          testID="sidebar-v2-menu-settle"
          onSelect={callbacks.onSettle}
          disabled={!capabilities.canSettle}
        >
          {t("sidebarV2.settle")}
        </ContextMenuItem>
      )}
      {capabilities.isSnoozed ? (
        <ContextMenuItem
          testID="sidebar-v2-menu-wake"
          onSelect={callbacks.onUnsnooze}
          disabled={!capabilities.canUnsnooze}
        >
          {t("sidebarV2.wake")}
        </ContextMenuItem>
      ) : (
        <>
          <ContextMenuLabel>{t("sidebarV2.snooze")}</ContextMenuLabel>
          {snoozePresets.map((preset) => (
            <SnoozePresetMenuItem
              key={preset.id}
              preset={preset}
              disabled={!capabilities.canSnooze}
              onSelect={handleSnoozePreset}
            />
          ))}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem testID="sidebar-v2-menu-rename" onSelect={callbacks.onRename}>
        {t("sidebarV2.rename")}
      </ContextMenuItem>
      <ContextMenuItem
        testID="sidebar-v2-menu-regenerate-title"
        onSelect={callbacks.onRegenerateTitle}
      >
        {t("sidebarV2.regenerateTitle")}
      </ContextMenuItem>
      <ContextMenuItem testID="sidebar-v2-menu-mark-unread" onSelect={callbacks.onMarkUnread}>
        {t("sidebarV2.markUnread")}
      </ContextMenuItem>
      <ContextMenuItem
        testID="sidebar-v2-menu-copy-path"
        onSelect={callbacks.onCopyPath}
        disabled={!thread.worktreePath && !thread.projectKey}
      >
        {t("sidebarV2.copyPath")}
      </ContextMenuItem>
      <ContextMenuItem
        testID="sidebar-v2-menu-copy-branch"
        onSelect={callbacks.onCopyBranch}
        disabled={!thread.branch}
      >
        {t("sidebarV2.copyBranch")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem testID="sidebar-v2-menu-delete" onSelect={callbacks.onDelete} destructive>
        {t("sidebarV2.delete")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function SnoozePresetMenuItem({
  preset,
  disabled,
  onSelect,
}: {
  preset: SnoozePreset;
  disabled: boolean;
  onSelect: (preset: SnoozePreset) => void;
}) {
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  return (
    <ContextMenuItem
      testID={`sidebar-v2-menu-snooze-${preset.id}`}
      onSelect={handleSelect}
      disabled={disabled}
    >
      {preset.label}
    </ContextMenuItem>
  );
}

function snoozeWakeDescriptionLocal(preset: SnoozePreset): string {
  return preset.whenLabel;
}
