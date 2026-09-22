import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { resolveSnoozePresets, type SnoozePreset } from "./snooze";
import type { SidebarV2Thread } from "./agent-adapter";

export interface SidebarV2BulkMenuCallbacks {
  onSettleSelected: () => void;
  onSnoozeSelected: (preset: SnoozePreset) => void;
  onMarkUnreadSelected: () => void;
  onRegenerateTitleSelected: () => void;
  onDeleteSelected: () => void;
}

export interface SidebarV2BulkMenuCapabilities {
  canSnoozeAll: boolean;
  canRegenerateTitle: boolean;
}

/**
 * Bulk multi-select context menu — mirrors T3's multi-select menu:
 * Settle (N), Snooze (N) presets, Regenerate title, Mark unread (N), Delete (N).
 */
export function SidebarV2BulkMenu({
  count,
  capabilities,
  callbacks,
}: {
  count: number;
  capabilities: SidebarV2BulkMenuCapabilities;
  callbacks: SidebarV2BulkMenuCallbacks;
}): ReactElement {
  const { t } = useTranslation();
  const snoozePresets = useMemo(() => resolveSnoozePresets(new Date()), []);

  return (
    <ContextMenuContent mobileMode="sheet" minWidth={220}>
      <ContextMenuItem onSelect={callbacks.onSettleSelected}>
        {t("sidebarV2.bulkSettle", { count })}
      </ContextMenuItem>
      {capabilities.canSnoozeAll ? (
        <>
          <ContextMenuLabel>{t("sidebarV2.bulkSnooze", { count })}</ContextMenuLabel>
          {snoozePresets.map((preset) => (
            <BulkSnoozePresetItem
              key={preset.id}
              preset={preset}
              onSelect={callbacks.onSnoozeSelected}
            />
          ))}
        </>
      ) : null}
      {capabilities.canRegenerateTitle ? (
        <ContextMenuItem onSelect={callbacks.onRegenerateTitleSelected}>
          {t("sidebarV2.bulkRegenerateTitle", { count })}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={callbacks.onMarkUnreadSelected}>
        {t("sidebarV2.bulkMarkUnread", { count })}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={callbacks.onDeleteSelected} destructive>
        {t("sidebarV2.bulkDelete", { count })}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * Whether every selected thread can accept a snooze right now.
 * @param threads Selected threads currently rendered
 * @param now ISO clock used by canSnooze
 * @param canSnoozeFn canSnooze predicate
 */
export function canSnoozeAllSelected(
  threads: readonly SidebarV2Thread[],
  now: string,
  canSnoozeFn: (thread: SidebarV2Thread, options: { readonly now: string }) => boolean,
): boolean {
  if (threads.length === 0) {
    return false;
  }
  return threads.every((thread) => canSnoozeFn(thread, { now }));
}

function BulkSnoozePresetItem({
  preset,
  onSelect,
}: {
  preset: SnoozePreset;
  onSelect: (preset: SnoozePreset) => void;
}) {
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  return (
    <ContextMenuItem onSelect={handleSelect}>
      {`${preset.label} (${preset.whenLabel})`}
    </ContextMenuItem>
  );
}
