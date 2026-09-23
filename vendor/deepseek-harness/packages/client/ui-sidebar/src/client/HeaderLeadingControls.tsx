/** Window-chrome controls for the fully hidden sidebar (frame shell.leading seat). */
import {
  IconNewChatOutlineRegular, IconPanelLeftOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the frame's shell.leading slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import css from './HeaderLeadingControls.module.css'

/** Full props of the shell.leading occupant. */
export type HeaderLeadingControlsProps =
  PropsRuntime<'shell.leading'>
  & InjectFace<SidebarRootInjected>
  & PropsLocale<'sidebar'>

/**
 * Sidebar-open and New Session controls in the frame's window-chrome seat.
 * On macOS desktop a collapsed sidebar hides entirely (no rail), taking both
 * controls off screen; this occupant puts them back beside the traffic
 * lights. The frame mounts the seat only in that state and owns its
 * placement, so the occupant renders unconditionally.
 * @param props - Injected sidebar actions plus the sidebar locale seat.
 * @returns the two window-chrome controls.
 */
export function HeaderLeadingControls({ toggleSidebar, startSession, t }: HeaderLeadingControlsProps) {
  return (
    <div className={css.controls}>
      <Tooltip label={t('toggle.open')} delayMs={500}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('toggle.open')}
          onClick={() => { toggleSidebar() }}
        >
          <IconPanelLeftOutlineRegular size={16} />
        </button>
      </Tooltip>
      <Tooltip label={t('session.new.label')} delayMs={500}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <IconNewChatOutlineRegular size={16} />
        </button>
      </Tooltip>
    </div>
  )
}
