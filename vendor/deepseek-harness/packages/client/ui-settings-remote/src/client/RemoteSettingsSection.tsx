/** Remote settings section: localized tabs around gateway + channels pages. */

import { useEffect, useId, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './RemoteSettingsSection.module.css'

/** One tab projected from a `settings.remote.tab` contribution. */
export interface RemoteSettingsTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the section. */
export interface RemoteSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Remote tab ledger. */
    tabs: HostObservable<readonly RemoteSettingsTabEntry[]>
  }
}

/** Props the renderer binds for the section. */
export type RemoteSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.remote'>
  & PropsRenderSlots<'settings.remote.tab'>
  & InjectFace<RemoteSettingsSectionInjected>

/** Render the Remote settings page whose contents arrive from feature-owned tabs. */
export function RemoteSettingsSection({ t, renderSlot, useTabs, close }: RemoteSettingsSectionProps) {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rows = useTabs(value => value)
  const [activeId, setActiveId] = useState<string>()
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id

  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  return (
    <div className={css.section} data-dsh-remote-settings="">
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <>
          <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
            {rows.map((row, index) => {
              const selected = row.id === active
              return (
                <button
                  key={row.id}
                  ref={(element) => { tabRefs.current[index] = element }}
                  id={`${tabsId}-tab-${row.id}`}
                  type="button"
                  role="tab"
                  className={css.tab}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-panel-${row.id}`}
                  data-active={selected ? 'true' : undefined}
                  data-dsh-settings-remote-tab={row.id}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => { setActiveId(row.id) }}
                  onKeyDown={(event) => {
                    let nextIndex: number
                    switch (event.key) {
                      case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                      case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                      case 'Home': nextIndex = 0; break
                      case 'End': nextIndex = rows.length - 1; break
                      default: return
                    }
                    event.preventDefault()
                    const nextRow = rows[nextIndex] as RemoteSettingsTabEntry
                    const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
                    setActiveId(nextRow.id)
                    nextTab.focus()
                  }}
                >
                  {row.label}
                </button>
              )
            })}
          </div>
          {rows
            .filter(row => row.id === active || visitedIds.has(row.id))
            .map((row) => {
              const selected = row.id === active
              return (
                <div
                  key={row.id}
                  id={`${tabsId}-panel-${row.id}`}
                  className={css.panel}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-tab-${row.id}`}
                  hidden={!selected}
                >
                  {renderSlot('settings.remote.tab', { close }, { only: row.id })}
                </div>
              )
            })}
        </>
      )}
    </div>
  )
}
