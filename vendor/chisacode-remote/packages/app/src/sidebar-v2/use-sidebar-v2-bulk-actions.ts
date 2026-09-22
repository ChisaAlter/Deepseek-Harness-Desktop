import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { canSnoozeAllSelected } from "./SidebarV2BulkMenu";
import { resolveSelectedThreads } from "./actions";
import { canSnooze, type SnoozePreset } from "./snooze";
import { sidebarV2ThreadKey } from "./store";
import type { SidebarV2Thread } from "./agent-adapter";

interface UseSidebarV2BulkActionsInput {
  selectedThreadKeys: readonly string[];
  threadByKey: ReadonlyMap<string, SidebarV2Thread>;
  snoozeNow: string;
  clearSelection: () => void;
  handleSettle: (thread: SidebarV2Thread, opts?: { coParkingKeys?: ReadonlySet<string> }) => void;
  handleSnooze: (
    thread: SidebarV2Thread,
    untilIso: string,
    opts?: {
      coParkingKeys?: ReadonlySet<string>;
      skipUndoToast?: boolean;
      whenLabel?: string;
    },
  ) => void;
  handleMarkUnread: (thread: SidebarV2Thread) => void;
  handleRegenerateTitle: (thread: SidebarV2Thread) => void;
  handleDelete: (thread: SidebarV2Thread, opts?: { skipConfirm?: boolean }) => void;
}

/**
 * Bulk multi-select actions for SidebarV2, matching T3's multi-select menu.
 */
export function useSidebarV2BulkActions(input: UseSidebarV2BulkActionsInput) {
  const { t } = useTranslation();
  const toast = useToast();

  const handleBulkSettle = useCallback(() => {
    const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
    const coParkingKeys = new Set(
      selected.map((thread) => sidebarV2ThreadKey(thread.serverId, thread.id)),
    );
    for (const thread of selected) {
      if (thread.settledOverride === "settled") {
        continue;
      }
      input.handleSettle(thread, { coParkingKeys });
    }
    input.clearSelection();
  }, [input]);

  const handleBulkSnooze = useCallback(
    (preset: SnoozePreset) => {
      const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
      const coParkingKeys = new Set(
        selected.map((thread) => sidebarV2ThreadKey(thread.serverId, thread.id)),
      );
      for (const thread of selected) {
        input.handleSnooze(thread, preset.snoozedUntil, {
          coParkingKeys,
          skipUndoToast: true,
          whenLabel: preset.whenLabel,
        });
      }
      toast.show(t("sidebarV2.snoozedUntil", { when: preset.whenLabel }), {
        variant: "success",
        durationMs: 5_000,
      });
      input.clearSelection();
    },
    [input, t, toast],
  );

  const handleBulkMarkUnread = useCallback(() => {
    const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
    for (const thread of selected) {
      input.handleMarkUnread(thread);
    }
    input.clearSelection();
  }, [input]);

  const handleBulkRegenerateTitle = useCallback(() => {
    const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
    for (const thread of selected) {
      input.handleRegenerateTitle(thread);
    }
    input.clearSelection();
  }, [input]);

  const handleBulkDelete = useCallback(() => {
    const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
    if (selected.length === 0) {
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebarV2.bulkDeleteTitle", { count: selected.length }),
        message: t("sidebarV2.bulkDeleteMessage"),
        confirmLabel: t("sidebar.deleteSession"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      for (const thread of selected) {
        input.handleDelete(thread, { skipConfirm: true });
      }
      input.clearSelection();
    })();
  }, [input, t]);

  const bulkMenuCapabilities = useMemo(() => {
    const selected = resolveSelectedThreads(input.selectedThreadKeys, input.threadByKey);
    return {
      canSnoozeAll: canSnoozeAllSelected(selected, input.snoozeNow, canSnooze),
      canRegenerateTitle: selected.length > 0,
    };
  }, [input.selectedThreadKeys, input.snoozeNow, input.threadByKey]);

  const bulkMenuCallbacks = useMemo(
    () => ({
      onSettleSelected: handleBulkSettle,
      onSnoozeSelected: handleBulkSnooze,
      onMarkUnreadSelected: handleBulkMarkUnread,
      onRegenerateTitleSelected: handleBulkRegenerateTitle,
      onDeleteSelected: handleBulkDelete,
    }),
    [
      handleBulkDelete,
      handleBulkMarkUnread,
      handleBulkRegenerateTitle,
      handleBulkSettle,
      handleBulkSnooze,
    ],
  );

  return { bulkMenuCapabilities, bulkMenuCallbacks };
}
