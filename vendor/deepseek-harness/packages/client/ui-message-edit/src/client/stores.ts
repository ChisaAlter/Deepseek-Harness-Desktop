/**
 * Message-edit interaction store shared by the pencil and the editor entries
 * (one handle passed to both registers; the framework caches one instance per
 * session). It carries the focus-return handshake: a cancelled edit unmounts
 * the editor before the pencil exists again, so the editor records the
 * request here and the remounted pencil consumes it. Module level exports the
 * factory only (a module-level handle would pin identity across plugin
 * reloads).
 * @module @deepseek-ai/dsh-client-ui-message-edit/client/stores
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
/** Focus-return handshake between the editor and the pencil. */
type MessageEditState = {
  /** Seq whose pencil takes focus on its next render, null when none is owed. */
  returnFocusSeq: number | null
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type MessageEditActions = {
  requestReturnFocus: (draft: MessageEditState, seq: number) => void
  clearReturnFocus: (draft: MessageEditState) => void
}

/**
 * Create the message-edit interaction store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createMessageEditStore(): EngineStoreHandle<MessageEditState, MessageEditActions> {
  return defineStore({
    init: (): MessageEditState => ({ returnFocusSeq: null }),
    actions: {
      requestReturnFocus: (d, seq: number) => { d.returnFocusSeq = seq },
      clearReturnFocus: (d) => { d.returnFocusSeq = null },
    },
  })
}
