import { useEffect } from "react";

import {
  keyboardActionDispatcher,
  type KeyboardActionDefinition,
  type KeyboardActionId,
} from "@/keyboard/keyboard-action-dispatcher";

interface UseKeyboardActionHandlerInput {
  handlerId: string;
  actions: readonly KeyboardActionId[];
  enabled: boolean;
  priority: number;
  isActive?: () => boolean;
  handle: (action: KeyboardActionDefinition) => boolean;
}

export function useKeyboardActionHandler(input: UseKeyboardActionHandlerInput) {
  // Compare `actions` by value (joined key) instead of array identity, so
  // callers passing inline array literals do not cause re-registration on every
  // render while the set of actions is unchanged.
  const actionsKey = input.actions.join(",");
  useEffect(() => {
    return keyboardActionDispatcher.registerHandler({
      handlerId: input.handlerId,
      actions: input.actions,
      enabled: input.enabled,
      priority: input.priority,
      isActive: input.isActive,
      handle: input.handle,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actionsKey is the canonical signal for input.actions changes
  }, [actionsKey, input.enabled, input.handle, input.handlerId, input.isActive, input.priority]);
}
