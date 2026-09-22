/** Interface Settings row: whether the sidebar draws the Archived section. */
import { useId, type ChangeEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createWorkspaceViewStore } from './stores.ts'
import type { WorkspaceKey } from './locales.ts'
import css from './ShowArchivedListRow.module.css'

/** Full Settings-row props: Interface item seat plus the workspace view store. */
export type ShowArchivedListRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'workspace'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>

/**
 * Render the show-archived-list Switch for Interface Settings.
 * @param props - composed Settings slot props with the shared view store.
 * @returns the preference row.
 */
export function ShowArchivedListRow({ useStore, actions, t }: ShowArchivedListRowProps) {
  const show = useStore(state => state.showArchivedList)
  const titleId = useId()
  const title: WorkspaceKey = 'settings.showArchived.title'
  const description: WorkspaceKey = 'settings.showArchived.description'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Switch
        checked={show}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          actions.setShowArchivedList(event.target.checked)
        }}
      />
    </div>
  )
}
