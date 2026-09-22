import { useCallback } from "react";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

export function useOpenProjectPicker(serverId: string | null): () => Promise<void> {
  const normalizedServerId = serverId?.trim() ?? "";
  const setProjectPickerOpen = useKeyboardShortcutsStore((state) => state.setProjectPickerOpen);

  return useCallback(async () => {
    if (!normalizedServerId) {
      return;
    }

    setProjectPickerOpen(true);
  }, [normalizedServerId, setProjectPickerOpen]);
}
