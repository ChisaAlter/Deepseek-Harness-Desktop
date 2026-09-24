import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { EmptyState } from './EmptyState.tsx'
import { NS } from './locales.ts'
import type { createSurfacesStore, OpenableKind, Surface } from './stores.ts'
import { persistSession, cancelPersist, writeSession, loadPersistedDrafts, collectDirtyDrafts } from './persist.ts'
import { sessionSurfaces } from './stores.ts'
import { SurfaceTabs } from './SurfaceTabs.tsx'
import css from './SurfacesRoot.module.css'

/** Must match ui-user-terminal; client packages cannot share a value export. */
const OPEN_SURFACE_EVENT = 'dshd-open-surface'

/** Must match ui-git; client packages cannot share a value export. */
const GIT_INIT_EVENT = 'dshd-git-init'

/** Layout write and probes injected so cards can open the column and disable Browser. */
export interface SurfacesRootInjected {
  openSurfaces: () => void
  /** True when desktop `window.shell.previewOpen` exists. */
  previewAvailable: boolean
  gitStatus: (cwd: string) => Promise<unknown>
}

export type SurfacesRootProps =
  & PropsRuntime<'surfaces'>
  & PropsStore<ReturnType<typeof createSurfacesStore>>
  & PropsRenderSlots<'surfaces.browser' | 'surfaces.terminal' | 'surfaces.files' | 'surfaces.file' | 'surfaces.diff' | 'surfaces.agents'>
  & PropsLocale<typeof NS>
  & InjectFace<SurfacesRootInjected>

function renderOccupant(
  surface: Surface,
  renderSlot: SurfacesRootProps['renderSlot'],
  openFile: (relativePath: string) => void,
  active: boolean,
  occluded: boolean,
  onDirtyChange: (dirty: boolean) => void,
  readBuffer: () => { text: string; draft: string } | undefined,
  writeBuffer: (buffer: { text: string; draft: string } | null) => void,
  registerSave: (save: (() => Promise<boolean>) | null) => void,
): ReactNode {
  switch (surface.kind) {
    case 'preview':
      return renderSlot('surfaces.browser', occluded ? { active, occluded: true } : { active })
    case 'terminal':
      return renderSlot('surfaces.terminal', {})
    case 'files':
      return renderSlot('surfaces.files', { openFile })
    case 'file':
      return renderSlot('surfaces.file', {
        relativePath: surface.relativePath,
        active,
        onDirtyChange,
        readBuffer,
        writeBuffer,
        registerSave,
        ...(surface.revealLine !== undefined ? { revealLine: surface.revealLine } : {}),
        ...(surface.revealRequestId !== undefined ? { revealRequestId: surface.revealRequestId } : {}),
      })
    case 'diff':
      return renderSlot('surfaces.diff', { openFile })
    case 'agents':
      return renderSlot('surfaces.agents', {})
    /* v8 ignore start -- Surface is a closed union; the never arm is uninhabited. */
    default: {
      const _never: never = surface
      return _never
    }
    /* v8 ignore stop */
  }
}

function currentCwd(useSessions: SurfacesRootProps['useSessions']): string | undefined {
  return useSessions((s) => {
    const mainView = Object.values(s.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
    const next = mainView?.cwd
    return next ? next : undefined
  })
}

/**
 * Occupant of the layout `surfaces` column: tab chrome is always mounted;
 * open occupants stay mounted (inactive ones are `hidden`) so Browser
 * history and unsaved Files drafts survive tab switches. Dirty file buffers
 * persist in localStorage with the tab list so reload and quit restore them.
 * Titlebar toggle only writes layout width.
 * @param props - session-maybe seats, the surfaces store, child slots, and copy.
 * @returns the right-panel shell.
 */
export function SurfacesRoot(props: SurfacesRootProps): ReactNode {
  const cwd = currentCwd(props.useSessions)
  const [gitRepo, setGitRepo] = useState(false)
  // ui-git broadcasts after a successful `git init`, so the Diff gate opens
  // without switching sessions; the bump re-runs the probe effect below.
  const [gitProbe, setGitProbe] = useState(0)
  useEffect(() => {
    const reprobe = (): void => { setGitProbe(probe => probe + 1) }
    window.addEventListener(GIT_INIT_EVENT, reprobe)
    return () => { window.removeEventListener(GIT_INIT_EVENT, reprobe) }
  }, [])
  useEffect(() => {
    if (cwd === undefined) {
      setGitRepo(false)
      return
    }
    let cancelled = false
    void props.gitStatus(cwd).then((status) => {
      if (!cancelled) setGitRepo(status !== null && status !== undefined)
    }).catch(() => {
      if (!cancelled) setGitRepo(false)
    })
    return () => { cancelled = true }
  }, [cwd, props.gitStatus, gitProbe])
  return (
    <SurfacesBody
      {...props}
      useStore={props.useStore}
      actions={props.actions}
      diffAvailable={cwd !== undefined && gitRepo}
    />
  )
}

type SurfacesBodyProps = SurfacesRootProps & PropsStore<ReturnType<typeof createSurfacesStore>> & {
  diffAvailable: boolean
}

function SurfacesBody({
  sessionId,
  useStore,
  actions,
  renderSlot,
  openSurfaces,
  previewAvailable,
  t,
  diffAvailable,
}: SurfacesBodyProps): ReactNode {
  const key = sessionId ?? ''
  const keyRef = useRef(key)
  keyRef.current = key
  const bucket = useStore(state => sessionSurfaces(state, key))
  const bucketRef = useRef(bucket)
  bucketRef.current = bucket
  const fileBuffers = useRef(loadPersistedDrafts())
  const flushDrafts = (): void => {
    const sessionKey = keyRef.current
    if (sessionKey.length === 0) return
    cancelPersist(sessionKey)
    writeSession(
      sessionKey,
      bucketRef.current,
      undefined,
      collectDirtyDrafts(sessionKey, fileBuffers.current, bucketRef.current.surfaces),
    )
  }
  useEffect(() => {
    if (key.length === 0) return
    persistSession(
      key,
      bucket,
      undefined,
      collectDirtyDrafts(key, fileBuffers.current, bucket.surfaces),
    )
    return () => {
      cancelPersist(key)
      const live = keyRef.current === key ? bucketRef.current : bucket
      writeSession(
        key,
        live,
        undefined,
        collectDirtyDrafts(key, fileBuffers.current, live.surfaces),
      )
    }
  }, [key, bucket])
  useEffect(() => {
    const onHide = (): void => { flushDrafts() }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [key])
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{ kind?: string; sessionId?: string } | undefined>).detail
      const kind = detail?.kind
      if (kind !== 'preview' && kind !== 'terminal' && kind !== 'files' && kind !== 'diff' && kind !== 'agents') {
        return
      }
      const targetSessionId = detail?.sessionId ?? key
      actions.open(targetSessionId, kind)
      if (targetSessionId === key) openSurfaces()
    }
    window.addEventListener(OPEN_SURFACE_EVENT, onOpen)
    return () => { window.removeEventListener(OPEN_SURFACE_EVENT, onOpen) }
  }, [key, actions, openSurfaces])
  const open = (kind: OpenableKind): void => {
    actions.open(key, kind)
    openSurfaces()
  }
  const openFile = (relativePath: string): void => {
    actions.openFile(key, relativePath)
    openSurfaces()
  }
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingClose, setPendingClose] = useState<
    | { kind: 'one'; id: string }
    | { kind: 'others'; id: string }
    | { kind: 'toRight'; id: string }
    | { kind: 'all' }
    | null
  >(null)
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false)

  const setDirty = useCallback((sessionKey: string, id: string, dirty: boolean): void => {
    if (sessionKey !== keyRef.current) return
    setDirtyIds((current) => {
      const has = current.has(id)
      if (dirty === has) return current
      const next = new Set(current)
      if (dirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /** Stable per-session+surface callbacks so FilePreview dirty effects do not loop on identity. */
  const dirtyChangeById = useRef(new Map<string, (dirty: boolean) => void>())
  const dirtyChangeFor = (id: string): ((dirty: boolean) => void) => {
    const dirtyKey = `${key}:${id}`
    const cached = dirtyChangeById.current.get(dirtyKey)
    if (cached !== undefined) return cached
    const sessionKey = key
    const next = (dirty: boolean): void => { setDirty(sessionKey, id, dirty) }
    dirtyChangeById.current.set(dirtyKey, next)
    return next
  }

  /** In-memory file buffers keyed by session+surface id; survive remount until tab close. */
  const bufferAccessById = useRef(new Map<string, {
    read: () => { text: string; draft: string } | undefined
    write: (buffer: { text: string; draft: string } | null) => void
  }>())
  const bufferAccessFor = (id: string): {
    read: () => { text: string; draft: string } | undefined
    write: (buffer: { text: string; draft: string } | null) => void
  } => {
    const bufferKey = `${key}:${id}`
    const cached = bufferAccessById.current.get(bufferKey)
    if (cached !== undefined) return cached
    const next = {
      read: (): { text: string; draft: string } | undefined => fileBuffers.current.get(bufferKey),
      write: (buffer: { text: string; draft: string } | null): void => {
        if (buffer === null) fileBuffers.current.delete(bufferKey)
        else fileBuffers.current.set(bufferKey, buffer)
        persistSession(
          key,
          bucketRef.current,
          undefined,
          collectDirtyDrafts(key, fileBuffers.current, bucketRef.current.surfaces),
        )
      },
    }
    bufferAccessById.current.set(bufferKey, next)
    return next
  }

  const saveById = useRef(new Map<string, () => Promise<boolean>>())
  const saveRegisterById = useRef(new Map<string, (save: (() => Promise<boolean>) | null) => void>())
  const registerSaveFor = (id: string): ((save: (() => Promise<boolean>) | null) => void) => {
    const saveKey = `${key}:${id}`
    const cached = saveRegisterById.current.get(saveKey)
    if (cached !== undefined) return cached
    const next = (save: (() => Promise<boolean>) | null): void => {
      if (save === null) saveById.current.delete(saveKey)
      else saveById.current.set(saveKey, save)
    }
    saveRegisterById.current.set(saveKey, next)
    return next
  }

  useEffect(() => {
    setPendingClose(null)
    const prefix = `${key}:`
    const next = new Set<string>()
    for (const [bufferKey, buffer] of fileBuffers.current) {
      if (!bufferKey.startsWith(prefix)) continue
      if (buffer.draft === buffer.text) continue
      next.add(bufferKey.slice(prefix.length))
    }
    setDirtyIds(next)
  }, [key])

  const idsClosing = (pending: NonNullable<typeof pendingClose>): string[] => {
    if (pending.kind === 'one') return [pending.id]
    if (pending.kind === 'all') return bucket.surfaces.map(surface => surface.id)
    if (pending.kind === 'others') {
      return bucket.surfaces.filter(surface => surface.id !== pending.id).map(surface => surface.id)
    }
    const index = bucket.surfaces.findIndex(surface => surface.id === pending.id)
    if (index < 0) return []
    return bucket.surfaces.slice(index + 1).map(surface => surface.id)
  }

  const bufferIsDirty = (id: string): boolean => {
    const buffer = fileBuffers.current.get(`${key}:${id}`)
    return buffer !== undefined && buffer.draft !== buffer.text
  }

  const runClose = (pending: NonNullable<typeof pendingClose>): void => {
    const closed = new Set(idsClosing(pending))
    if (pending.kind === 'one') actions.close(key, pending.id)
    else if (pending.kind === 'others') actions.closeOthers(key, pending.id)
    else if (pending.kind === 'toRight') actions.closeToRight(key, pending.id)
    else actions.closeAll(key)
    for (const id of closed) {
      const bufferKey = `${key}:${id}`
      fileBuffers.current.delete(bufferKey)
      bufferAccessById.current.delete(bufferKey)
      dirtyChangeById.current.delete(bufferKey)
      saveById.current.delete(bufferKey)
      saveRegisterById.current.delete(bufferKey)
    }
    setDirtyIds(current => new Set([...current].filter(id => !closed.has(id))))
    setPendingClose(null)
    flushDrafts()
  }

  const requestClose = (
    pending: NonNullable<typeof pendingClose>,
  ): void => {
    const closing = idsClosing(pending)
    if (closing.some(id => dirtyIds.has(id) || bufferIsDirty(id))) {
      setPendingClose(pending)
      return
    }
    runClose(pending)
  }

  return (
    <div className={css.root} data-surfaces-root>
      <SurfaceTabs
        surfaces={bucket.surfaces}
        activeId={bucket.activeId}
        onActivate={(id) => { actions.activate(key, id) }}
        onClose={(id) => { requestClose({ kind: 'one', id }) }}
        onCloseOthers={(id) => { requestClose({ kind: 'others', id }) }}
        onCloseToRight={(id) => { requestClose({ kind: 'toRight', id }) }}
        onCloseAll={() => { requestClose({ kind: 'all' }) }}
        onOpenKind={open}
        onMenuOpenChange={setTabsMenuOpen}
        openable={{
          preview: previewAvailable && !bucket.surfaces.some(surface => surface.kind === 'preview'),
          terminal: !bucket.surfaces.some(surface => surface.kind === 'terminal'),
          files: !bucket.surfaces.some(surface => surface.kind === 'files'),
          diff: diffAvailable && !bucket.surfaces.some(surface => surface.kind === 'diff'),
          agents: !bucket.surfaces.some(surface => surface.kind === 'agents'),
        }}
        t={t}
      />
      {bucket.surfaces.length === 0 ? (
        <EmptyState
          onOpen={open}
          t={t}
          browserAvailable={previewAvailable}
          diffAvailable={diffAvailable}
        />
      ) : (
        <div className={css.body}>
          {bucket.surfaces.map((surface) => {
            const isActive = surface.id === bucket.activeId
            const buffers = bufferAccessFor(surface.id)
            return (
              <div
                key={`${key}:${surface.id}`}
                className={css.occupant}
                data-surfaces-occupant={isActive ? 'active' : 'idle'}
                hidden={!isActive}
                aria-hidden={!isActive}
              >
                {renderOccupant(
                  surface,
                  renderSlot,
                  openFile,
                  isActive,
                  tabsMenuOpen || pendingClose !== null,
                  dirtyChangeFor(surface.id),
                  buffers.read,
                  buffers.write,
                  registerSaveFor(surface.id),
                )}
              </div>
            )
          })}
        </div>
      )}
      <Modal
        open={pendingClose !== null}
        onClose={() => { setPendingClose(null) }}
        title={t('unsaved.title')}
        closeLabel={t('unsaved.close')}
        description={
          pendingClose !== null
          && idsClosing(pendingClose).filter(id => dirtyIds.has(id) || bufferIsDirty(id)).length > 1
            ? t('unsaved.bodyMany')
            : t('unsaved.body')
        }
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setPendingClose(null) }}>{t('unsaved.keep')}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                /* v8 ignore next -- confirm is only rendered while pendingClose is set. */
                if (pendingClose !== null) runClose(pendingClose)
              }}
            >
              {t('unsaved.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void (async () => {
                  if (pendingClose === null) return
                  const pending = pendingClose
                  const dirty = idsClosing(pending).filter(id => dirtyIds.has(id) || bufferIsDirty(id))
                  for (const id of dirty) {
                    const save = saveById.current.get(`${key}:${id}`)
                    if (save === undefined) return
                    const ok = await save()
                    if (!ok) return
                  }
                  runClose(pending)
                })()
              }}
            >
              {t('unsaved.save')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
