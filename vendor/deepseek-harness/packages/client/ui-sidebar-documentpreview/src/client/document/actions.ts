/**
 * Generic toolbar-action seat for the native document preview.
 *
 * The document owner renders the path and built-in viewer controls. Products
 * and extensions may append their own controls without replacing the header or
 * learning its private state. The enclosing tab reader is forwarded through the
 * standard hook-context mechanism so an action can read the resource identity.
 */
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extra controls at the end of the native document preview's header. */
    'sidebar.right.tab.document.actions': {
      kind: 'list'
      scope: 'session'
      owner: DocumentActionsOwner
      hookContext: UseSidebarRightTabInfo
      inject: {
        hooks: {
          tabInfo: SlotHookFactory<
            'sidebar.right.tab.document.actions',
            UseSidebarRightTabInfo
          >
        }
      }
    }
  }
}

/** Owner facts shared by every contributed document action. */
export interface DocumentActionsOwner {
  /** The file resource address currently shown by the document preview. */
  readonly resourceAddress: string
}

/**
 * Forward the enclosing tab reader to a contributed action.
 * @param _standard - framework standard props.
 * @param useTabInfo - enclosing tab's bound reader.
 * @returns the same reader, without another subscription adapter.
 */
export const documentActionsTabInfoFactory: SlotHookFactory<
  'sidebar.right.tab.document.actions',
  UseSidebarRightTabInfo
> = (_standard, useTabInfo) => useTabInfo
