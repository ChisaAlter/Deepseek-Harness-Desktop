import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutline16,
  IconPlusOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { OpenableKind, Surface } from './stores.ts'
import css from './SurfaceTabs.module.css'

const ADD_KINDS: readonly OpenableKind[] = ['preview', 'terminal', 'files', 'diff', 'agents']

const ADD_LABEL: Record<OpenableKind, 'card.browser' | 'card.terminal' | 'card.files' | 'card.diff' | 'card.agents'> = {
  preview: 'card.browser',
  terminal: 'card.terminal',
  files: 'card.files',
  diff: 'card.diff',
  agents: 'card.agents',
}

export type SurfaceTabsProps = PropsLocale<typeof NS> & {
  surfaces: readonly Surface[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseAll: () => void
  onOpenKind: (kind: OpenableKind) => void
  onMenuOpenChange: (open: boolean) => void
  openable: Readonly<Record<OpenableKind, boolean>>
}

/**
 * Tab title for a surface descriptor.
 * @param surface - the surface.
 * @param t - locale translate.
 * @returns the tab label.
 */
export function surfaceTitle(surface: Surface, t: SurfaceTabsProps['t']): string {
  switch (surface.kind) {
    case 'preview':
      return t('card.browser')
    case 'terminal':
      return t('card.terminal')
    case 'files':
      return t('card.files')
    case 'diff':
      return t('card.diff')
    case 'agents':
      return t('card.agents')
    case 'file': {
      const slash = surface.relativePath.lastIndexOf('/')
      return slash < 0 ? surface.relativePath : surface.relativePath.slice(slash + 1)
    }
    /* v8 ignore next -- Surface is a closed union; the never arm is uninhabited. */
    default: {
      const _never: never = surface
      return _never
    }
  }
}

/**
 * Surface tab strip: activate, trailing close (right of the label; do not
 * move it without an explicit product request), add-menu, middle-click,
 * context menu, and non-passive wheel-to-horizontal scroll. Mounted even
 * with zero surfaces so the titlebar row and window-control pad remain.
 * @param props - surfaces, the active id, callbacks, and copy.
 * @returns the tab bar.
 */
export function SurfaceTabs({
  surfaces, activeId, onActivate, onClose, onCloseOthers, onCloseToRight, onCloseAll,
  onOpenKind, onMenuOpenChange, openable, t,
}: SurfaceTabsProps): ReactNode {
  const barRef = useRef<HTMLDivElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = barRef.current
    /* v8 ignore next -- the tab bar ref is attached on the host the effect reads. */
    if (el === null) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      if (el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += event.deltaY
      event.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  const addItems: MenuEntry[] = ADD_KINDS.map(kind => ({
    id: kind,
    label: t(ADD_LABEL[kind]),
    disabled: !openable[kind],
  }))

  const contextItems = (id: string): MenuEntry[] => {
    const index = surfaces.findIndex(surface => surface.id === id)
    return [
      { id: 'close', label: t('tab.close') },
      { id: 'closeOthers', label: t('tab.closeOthers'), disabled: surfaces.length < 2 },
      { id: 'closeToRight', label: t('tab.closeToRight'), disabled: index < 0 || index === surfaces.length - 1 },
      { id: 'closeAll', label: t('tab.closeAll') },
    ]
  }

  const onTabMouseDown = (id: string, event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return
    event.preventDefault()
    onClose(id)
  }

  const onTabContext = (id: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setAddOpen(false)
    setMenu({ id, x: event.clientX, y: event.clientY })
    onMenuOpenChange(true)
  }

  return (
    <div ref={barRef} className={css.bar} data-surfaces-tabs>
      {surfaces.map((surface) => {
        const title = surfaceTitle(surface, t)
        const active = surface.id === activeId
        return (
          <div
            key={surface.id}
            className={clsx(css.tab, active && css.active)}
            data-surfaces-tab
            data-active-tab={active || undefined}
            onMouseDown={(event) => { onTabMouseDown(surface.id, event) }}
            onContextMenu={(event) => { onTabContext(surface.id, event) }}
          >
            <button
              type="button"
              className={css.label}
              onClick={() => { onActivate(surface.id) }}
            >
              {title}
            </button>
            <button
              type="button"
              className={css.close}
              aria-label={`${t('tab.close')} ${title}`}
              onClick={() => { onClose(surface.id) }}
            >
              <IconCloseOutline16 size={12} />
            </button>
          </div>
        )
      })}
      {surfaces.length > 0 ? (
        <Menu
          className={css.interactive}
          open={addOpen}
          portal
          compact
          align="end"
          items={addItems}
          onSelect={(id) => {
            setAddOpen(false)
            onMenuOpenChange(false)
            onOpenKind(id as OpenableKind)
          }}
          onClose={() => {
            setAddOpen(false)
            onMenuOpenChange(false)
          }}
          anchor={(
            <button
              type="button"
              className={css.add}
              aria-label={t('tab.add')}
              data-surfaces-tab-add
              onClick={() => {
                setMenu(null)
                const next = !addOpen
                setAddOpen(next)
                onMenuOpenChange(next)
              }}
            >
              <IconPlusOutline16 size={14} />
            </button>
          )}
        />
      ) : null}
      {menu !== null ? (
        <Menu
          className={css.interactive}
          open
          portal
          compact
          getAnchorRect={() => new DOMRect(menu.x, menu.y, 0, 0)}
          items={contextItems(menu.id)}
          onSelect={(id) => {
            const target = menu.id
            setMenu(null)
            onMenuOpenChange(false)
            switch (id) {
              case 'close':
                onClose(target)
                break
              case 'closeOthers':
                onCloseOthers(target)
                break
              case 'closeToRight':
                onCloseToRight(target)
                break
              case 'closeAll':
                onCloseAll()
                break
              /* v8 ignore next -- Menu only emits the declared item ids. */
              default:
                break
            }
          }}
          onClose={() => {
            setMenu(null)
            onMenuOpenChange(false)
          }}
          anchor={<span className={css.contextAnchor} />}
        />
      ) : null}
    </div>
  )
}
