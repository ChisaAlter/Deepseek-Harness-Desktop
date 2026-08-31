/**
 * Settings Skills page: searchable flat catalog with a local editor.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  SkillInventoryDetail,
  SkillInventoryEntry,
  SkillInventorySnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSkillOutline16,
  IconTrashOutline16,
  Input,
  Menu,
  Modal,
  Pill,
  SettingsSelect,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsSettingsKey } from './locales.ts'
import styles from './SkillsSection.module.css'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type SkillCreateRoot = 'user-dsh' | 'project-dsh'
type SourceFilter = 'all' | 'user' | 'project' | 'bundled' | 'other'
type RowAction = 'detail' | 'invocation' | 'open'
type FieldErrors = Partial<Record<'name' | 'description' | 'content', string>>

interface SkillInventoryClientScope {
  sessionId?: SessionId
  cwd?: string
}

interface SkillCreateInput extends SkillInventoryClientScope {
  name: string
  description: string
  whenToUse?: string
  groups: readonly string[]
  content: string
  root: SkillCreateRoot
  modelInvocable: boolean
  userInvocable: boolean
}

interface EditorDraft {
  name: string
  description: string
  whenToUse?: string
  groups: string[]
  content: string
  root: SkillCreateRoot
  modelInvocable: boolean
  userInvocable: boolean
}

/** Injected Host Remote wrappers. */
export interface SkillsSectionInjected {
  list: (scope: SkillInventoryClientScope) => Promise<SkillInventorySnapshot>
  get: (name: string, scope: SkillInventoryClientScope) => Promise<SkillInventoryDetail>
  create: (input: SkillCreateInput) => Promise<void>
  update: (input: SkillInventoryClientScope & {
    name: string
    description: string
    whenToUse?: string
    groups: readonly string[]
    content: string
    modelInvocable: boolean
    userInvocable: boolean
  }) => Promise<void>
  remove: (name: string, scope: SkillInventoryClientScope) => Promise<void>
  setInvocation: (
    name: string,
    modelInvocable: boolean,
    userInvocable: boolean,
    scope: SkillInventoryClientScope,
  ) => Promise<void>
  /** Open a host directory with the OS default handler. */
  openDirectory: (directory: string) => Promise<void>
  t: (key: SkillsSettingsKey) => string
}

/** Slot props for `settings.section` id `skills`. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

type View =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: SkillInventorySnapshot }

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; detail: SkillInventoryDetail }

/** Render the Skills settings page. */
export function SkillsSection(props: SkillsSectionProps) {
  const t = props.t
  const sessionId = props.useSessions(sessions => sessions.current)
  const rawCwd = props.useSessions((sessions) => {
    const current = sessions.current
    return current === undefined ? undefined : sessions.byId[current]?.cwd
  })
  const observedCwd = rawCwd === undefined || rawCwd.trim().length === 0 ? undefined : rawCwd
  // A session's cwd never changes once set, but a sessions-store rebuild can
  // make the current entry read undefined for one render. Keep the last known
  // cwd per session so a flicker cannot silently rescope the catalog request
  // to the no-project view.
  const lastKnownCwd = useRef<Map<string, string>>(new Map())
  if (sessionId !== undefined && observedCwd !== undefined) {
    lastKnownCwd.current.set(sessionId, observedCwd)
  }
  const rememberedCwd = sessionId === undefined ? undefined : lastKnownCwd.current.get(sessionId)
  const cwd = observedCwd ?? rememberedCwd
  const scope: SkillInventoryClientScope = {
    ...sessionId === undefined ? {} : { sessionId },
    ...cwd === undefined ? {} : { cwd },
  }
  const scopeGeneration = useRef(0)
  const loadSequence = useRef(0)
  const [view, setView] = useState<View>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [details, setDetails] = useState<Readonly<Record<string, SkillInventoryDetail>>>({})
  const [pendingRows, setPendingRows] = useState<Readonly<Record<string, RowAction | undefined>>>({})
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string | undefined>>>({})
  const [editor, setEditor] = useState<EditorState | undefined>()
  const [editorPending, setEditorPending] = useState(false)
  const [editorError, setEditorError] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<SkillInventoryEntry | undefined>()
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [refreshFailure, setRefreshFailure] = useState(false)
  // Set when the session-scoped catalog read failed and the load fell back to
  // the global catalog (a live session whose boot failed cannot back the
  // layered view, but the global catalog stays readable).
  const [scopeFallback, setScopeFallback] = useState(false)
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>(() => readTreeState())
  const [groupPending, setGroupPending] = useState<Readonly<Record<string, boolean>>>({})

  const load = (replace: boolean): void => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    if (replace) setView({ status: 'loading' })
    const scoped = scope.sessionId !== undefined || scope.cwd !== undefined
    let usedFallback = false
    const read = scoped
      ? props.list(scope).catch(() => {
        usedFallback = true
        return props.list({})
      })
      : props.list(scope)
    void read
      .then((snapshot) => {
        if (loadSequence.current !== sequence) return
        setScopeFallback(usedFallback)
        setView({ status: 'ready', snapshot })
        setRefreshFailure(false)
      })
      .catch(() => {
        if (loadSequence.current !== sequence) return
        if (replace) setView({ status: 'error' })
        else setRefreshFailure(true)
      })
  }

  useEffect(() => {
    setDetails({})
    setPendingRows({})
    setRowErrors({})
    setEditor(undefined)
    setEditorPending(false)
    setEditorError(undefined)
    setDeleting(undefined)
    setDeletePending(false)
    setDeleteError(undefined)
    setRefreshFailure(false)
    setScopeFallback(false)
    scopeGeneration.current += 1
    load(true)
    return () => {
      scopeGeneration.current += 1
      loadSequence.current += 1
    }
  }, [cwd, sessionId, props.list])

  const filtered = view.status !== 'ready' ? [] : view.snapshot.skills.filter((skill) => {
    const needle = query.trim().toLocaleLowerCase()
    const matchesSearch = needle.length === 0 || [skill.name, skill.description, ...(skill.groups ?? []), skill.whenToUse ?? '']
      .some(value => value.toLocaleLowerCase().includes(needle))
    return matchesSearch && matchesSource(skill, sourceFilter)
  })

  if (view.status === 'loading') {
    return <div className={styles.section}><p className={styles.intro} role="status">{t('loading')}</p></div>
  }
  if (view.status === 'error') {
    return (
      <div className={styles.section}>
        <p className={styles.error} role="alert">{t('error')}</p>
        <Button variant="outline" onClick={() => { load(true) }}>{t('retry')}</Button>
      </div>
    )
  }

  const setRowPending = (key: string, action: RowAction | undefined): void => {
    setPendingRows(current => ({ ...current, [key]: action }))
  }
  const setRowError = (key: string, message: string | undefined): void => {
    setRowErrors(current => ({ ...current, [key]: message }))
  }
  const cacheDetail = (key: string, detail: SkillInventoryDetail): void => {
    setDetails(current => ({ ...current, [key]: detail }))
  }
  const updateEntry = (key: string, changes: Partial<SkillInventoryEntry>): void => {
    /* v8 ignore next -- updateEntry only fires from rendered rows, so the view is ready */
    setView(current => current.status !== 'ready' ? current : ({
      status: 'ready',
      snapshot: {
        ...current.snapshot,
        skills: current.snapshot.skills.map(skill => skillKey(skill) === key ? { ...skill, ...changes } : skill),
      },
    }))
    setDetails(current => current[key] === undefined ? current : ({
      ...current,
      [key]: { ...current[key], ...changes },
    }))
  }
  const requestDetail = (skill: SkillInventoryEntry): void => {
    const key = skillKey(skill)
    /* v8 ignore next -- rowMain guards pending clicks before requestDetail runs */
    if (pendingRows[key] !== undefined) return
    const cached = details[key]
    if (cached !== undefined) {
      setEditor({ mode: 'edit', detail: cached })
      return
    }
    const generation = scopeGeneration.current
    setRowPending(key, 'detail')
    setRowError(key, undefined)
    void props.get(skill.name, scope)
      .then((detail) => {
        if (scopeGeneration.current !== generation) return
        cacheDetail(key, detail)
        setEditor({ mode: 'edit', detail })
      })
      .catch((error: unknown) => {
        if (scopeGeneration.current === generation) setRowError(key, messageOf(error, t('detailFailed')))
      })
      .finally(() => {
        if (scopeGeneration.current === generation) setRowPending(key, undefined)
      })
  }
  const setInvocation = (skill: SkillInventoryEntry, modelInvocable: boolean, userInvocable: boolean): void => {
    const key = skillKey(skill)
    /* v8 ignore next -- the row switch disables while its invocation is pending */
    if (pendingRows[key] !== undefined) return
    const generation = scopeGeneration.current
    setRowPending(key, 'invocation')
    setRowError(key, undefined)
    void props.setInvocation(skill.name, modelInvocable, userInvocable, scope)
      .then(() => {
        if (scopeGeneration.current === generation) updateEntry(key, { modelInvocable, userInvocable })
      })
      .catch((error: unknown) => {
        if (scopeGeneration.current === generation) setRowError(key, messageOf(error, t('invocationFailed')))
      })
      .finally(() => {
        if (scopeGeneration.current === generation) setRowPending(key, undefined)
      })
  }
  const openDirectory = (skill: SkillInventoryEntry): void => {
    const key = skillKey(skill)
    const directory = skill.directory
    /* v8 ignore next -- the button only renders with a directory and disables while pending */
    if (directory === undefined || pendingRows[key] !== undefined) return
    const generation = scopeGeneration.current
    setRowPending(key, 'open')
    setRowError(key, undefined)
    void props.openDirectory(directory)
      .catch((error: unknown) => {
        if (scopeGeneration.current === generation) setRowError(key, messageOf(error, t('openDirectoryFailed')))
      })
      .finally(() => {
        if (scopeGeneration.current === generation) setRowPending(key, undefined)
      })
  }
  const setGroupExpanded = (groupKey: string, open: boolean): void => {
    setExpanded((current) => {
      const next = { ...current, [groupKey]: open }
      persistTreeState(next)
      return next
    })
  }
  const toggleGroup = (section: GroupSection): void => {
    const groupKey = groupKeyOf(section)
    setGroupExpanded(groupKey, !(expanded[groupKey] ?? true))
  }
  const setGroupInvocation = (section: GroupSection, modelInvocable: boolean): void => {
    const groupKey = groupKeyOf(section)
    const writable = section.skills.filter(skill => skill.writable)
    /* v8 ignore next -- unreachable: the group switch is disabled while pending and without writable skills */
    if (writable.length === 0 || groupPending[groupKey] === true) return
    const generation = scopeGeneration.current
    setGroupPending(current => ({ ...current, [groupKey]: true }))
    // Optimistic echo of the gesture: flip every writable row immediately so
    // the switch responds without waiting for the frontmatter writes, then
    // revert a row whose write failed.
    for (const skill of writable) {
      const key = skillKey(skill)
      updateEntry(key, { modelInvocable })
      setRowPending(key, 'invocation')
      setRowError(key, undefined)
    }
    const settled = writable.map(skill => {
      const previous = skill.modelInvocable
      return props.setInvocation(skill.name, modelInvocable, skill.userInvocable, scope)
        .catch((error: unknown) => {
          if (scopeGeneration.current !== generation) return
          updateEntry(skillKey(skill), { modelInvocable: previous })
          setRowError(skillKey(skill), messageOf(error, t('invocationFailed')))
        })
        .finally(() => {
          if (scopeGeneration.current === generation) setRowPending(skillKey(skill), undefined)
        })
    })
    void Promise.all(settled).finally(() => {
      if (scopeGeneration.current === generation) setGroupPending(current => ({ ...current, [groupKey]: false }))
    })
  }

  const hasFilters = query.trim().length > 0 || sourceFilter !== 'all'
  const sourceOptions = [
    ['all', t('filterAll')],
    ['user', t('sourceUser')],
    ['project', t('sourceProject')],
    ['bundled', t('sourceBundled')],
    ['other', t('sourceOther')],
  ] as const
  const sections = groupSections(filtered)
  const groupOptions = distinctGroups(view.snapshot.skills)

  const renderRow = (skill: SkillInventoryEntry) => {
    const key = skillKey(skill)
    const pending = pendingRows[key]
    const rowError = rowErrors[key]
    return (
      <li key={key} className={styles.row}>
        <button
          type="button"
          className={styles.rowMain}
          disabled={!skill.writable}
          onClick={() => {
            if (!skill.writable || pending !== undefined) return
            setEditorError(undefined)
            requestDetail(skill)
          }}
        >
          <span className={styles.skillIcon}><IconSkillOutline16 /></span>
          <span className={styles.summary}>
            <span className={styles.name}>{skill.name}</span>
            <span className={styles.description}>{skill.description}</span>
          </span>
        </button>
        <div className={styles.rowMeta}>
          {pending === 'detail' && <span className={styles.pending} role="status">{t('loadingDetail')}</span>}
          <Pill>{t(sourceLabel(skill.source))}</Pill>
          {skill.directory !== undefined && (
            <button
              type="button"
              className={styles.iconButton}
              disabled={pending !== undefined}
              aria-label={format(t('openDirectoryFor'), { name: skill.name })}
              onClick={() => { openDirectory(skill) }}
            >
              <IconFolderOpenOutline16 />
            </button>
          )}
          <Switch
            checked={skill.modelInvocable}
            disabled={!skill.writable || pending === 'invocation'}
            aria-label={format(t('modelFor'), { name: skill.name })}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setInvocation(skill, event.target.checked, skill.userInvocable)
            }}
          />
          {skill.writable && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={format(t('removeFor'), { name: skill.name })}
              onClick={() => {
                setDeleteError(undefined)
                setDeleting(skill)
              }}
            >
              <IconTrashOutline16 />
            </button>
          )}
        </div>
        {rowError !== undefined && <p className={styles.rowError} role="alert">{rowError}</p>}
      </li>
    )
  }

  return (
    <div className={styles.section}>
      <div className={styles.heading}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.intro}>{t('intro')}</p>
        </div>
        <div className={styles.headingActions}>
          <Button
            size="sm"
            variant="outline"
            className={styles.iconAction}
            icon={<IconPlusOutline16 />}
            aria-label={t('add')}
            onClick={() => { setEditor({ mode: 'create' }); setEditorError(undefined) }}
          />
          <Button
            size="sm"
            variant="outline"
            className={styles.iconAction}
            icon={<IconRefreshOutline16 />}
            aria-label={t('refresh')}
            onClick={() => { load(false) }}
          />
        </div>
      </div>

      {scopeFallback
        ? <p className={styles.scopeNotice}>{t('sessionCatalogUnavailable')}</p>
        : cwd === undefined ? <p className={styles.scopeNotice}>{t('projectCatalogUnavailable')}</p> : null}
      {refreshFailure ? (
        <div className={styles.loadFailure}>
          <p role="alert">{t('refreshFailed')}</p>
          <Button variant="outline" onClick={() => { load(false) }}>{t('retry')}</Button>
        </div>
      ) : null}

      <div className={styles.searchRow}>
        <Input
          className={styles.search}
          type="search"
          value={query}
          icon={<IconSearchOutline16 />}
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <SettingsSelect
          align="end"
          aria-label={t('sourceFilter')}
          value={sourceFilter}
          options={sourceOptions.map(([id, label]) => ({ id, label }))}
          onChange={(id) => { setSourceFilter(id as SourceFilter) }}
        />
      </div>

      <p className={styles.resultCount} aria-live="polite">
        {format(t('resultCount'), { count: String(filtered.length) })}
        {hasFilters && (
          <Button
            className={styles.clearFilters}
            size="sm"
            onClick={() => {
              setQuery('')
              setSourceFilter('all')
            }}
          >
            {t('clearFilters')}
          </Button>
        )}
      </p>

      {view.snapshot.skills.length === 0
        ? <p className={styles.empty}>{t('empty')}</p>
        : filtered.length === 0
          ? <p className={styles.empty}>{t('noResults')}</p>
          : sections.length <= 1 && (sections[0]?.group === undefined)
            ? (
              <ul className={styles.rows}>
                {filtered.map(skill => renderRow(skill))}
              </ul>
            )
            : (
              sections.map((section, index) => {
                const groupKey = groupKeyOf(section)
                const label = section.group ?? t('ungrouped')
                const open = expanded[groupKey] ?? true
                const writable = section.skills.filter(skill => skill.writable)
                const hasWritable = writable.length > 0
                const allEnabled = hasWritable && writable.every(skill => skill.modelInvocable)
                const pendingGroup = groupPending[groupKey] === true
                return (
                  <section
                    key={section.group ?? `ungrouped-${index}`}
                    className={allEnabled ? styles.groupSection : `${styles.groupSection} ${styles.groupOff}`}
                  >
                    <div className={styles.groupHeaderRow}>
                      <button
                        type="button"
                        className={styles.groupDisclosure}
                        aria-expanded={open}
                        onClick={() => { toggleGroup(section) }}
                      >
                        {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                        <span className={styles.groupName}>{label}</span>
                        <span className={styles.groupCount}>{format(t('groupCount'), { count: String(section.skills.length) })}</span>
                      </button>
                      <Switch
                        checked={allEnabled}
                        disabled={!hasWritable || pendingGroup}
                        aria-label={format(t('groupToggleFor'), { group: label })}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                          setGroupInvocation(section, event.target.checked)
                        }}
                      />
                    </div>
                    {open && (
                      <ul className={`${styles.rows} ${styles.treeRows}`}>
                        {section.skills.map(skill => renderRow(skill))}
                      </ul>
                    )}
                  </section>
                )
              })
            )}

      <SkillEditor
        open={editor !== undefined}
        creating={editor?.mode === 'create'}
        draft={editor?.mode === 'edit' ? editorDraft(editor.detail) : emptySkill()}
        cwd={cwd}
        groups={groupOptions}
        pending={editorPending}
        submitError={editorError}
        t={t}
        onClose={() => { if (!editorPending) setEditor(undefined) }}
        onSave={(draft) => {
          /* v8 ignore next -- onSave only fires from the editor while it is open */
          if (editor === undefined) return
          const activeEditor = editor
          const generation = scopeGeneration.current
          setEditorPending(true)
          setEditorError(undefined)
          const whenToUse = optionalWhenToUse(draft.whenToUse)
          const groups = normalizeGroups(draft.groups)
          const work = activeEditor.mode === 'create'
            ? props.create({
              name: draft.name,
              description: draft.description.trim(),
              ...whenToUse,
              groups,
              content: draft.content,
              root: draft.root,
              modelInvocable: draft.modelInvocable,
              userInvocable: draft.userInvocable,
              ...scope,
            })
            : props.update({
              name: draft.name,
              description: draft.description.trim(),
              ...whenToUse,
              groups,
              content: draft.content,
              modelInvocable: draft.modelInvocable,
              userInvocable: draft.userInvocable,
              ...scope,
            })
          void work
            .then(() => {
              if (scopeGeneration.current !== generation) return
              if (activeEditor.mode === 'edit') {
                const key = skillKey(activeEditor.detail)
                const entryChanges = {
                  description: draft.description.trim(),
                  groups,
                  modelInvocable: draft.modelInvocable,
                  userInvocable: draft.userInvocable,
                }
                const detailChanges = {
                  ...entryChanges,
                  content: draft.content,
                  ...draft.whenToUse === undefined || draft.whenToUse.trim().length === 0
                    ? {}
                    : { whenToUse: draft.whenToUse.trim() },
                }
                const detailBase = { ...activeEditor.detail }
                delete detailBase.whenToUse
                updateEntry(key, entryChanges)
                cacheDetail(key, { ...detailBase, ...detailChanges })
              }
              setEditor(undefined)
              setEditorPending(false)
              load(false)
            })
            .catch((error: unknown) => {
              if (scopeGeneration.current !== generation) return
              setEditorError(messageOf(error, t('saveFailed')))
              setEditorPending(false)
            })
        }}
      />

      <Modal
        open={deleting !== undefined}
        onClose={() => { if (!deletePending) setDeleting(undefined) }}
        title={format(t('deleteTitle'), { name: deleting?.name ?? '' })}
        closeLabel={t('close')}
        description={format(t('deleteBody'), { name: deleting?.name ?? '' })}
        footer={(
          <>
            <Button disabled={deletePending} onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={deletePending}
              onClick={() => {
                /* v8 ignore next -- the confirm button only renders while a target is selected */
                if (deleting === undefined) return
                const target = deleting
                const generation = scopeGeneration.current
                setDeletePending(true)
                setDeleteError(undefined)
                void props.remove(target.name, scope)
                  .then(() => {
                    if (scopeGeneration.current !== generation) return
                    const removedKey = skillKey(target)
                    /* v8 ignore next -- the confirm button only renders while the view is ready */
                    setView(current => current.status !== 'ready' ? current : ({
                      status: 'ready',
                      snapshot: {
                        ...current.snapshot,
                        skills: current.snapshot.skills.filter(skill => skillKey(skill) !== removedKey),
                      },
                    }))
                    setDeletePending(false)
                    setDeleting(undefined)
                  })
                  .catch((error: unknown) => {
                    if (scopeGeneration.current !== generation) return
                    setDeleteError(messageOf(error, t('deleteFailed')))
                    setDeletePending(false)
                  })
              }}
            >
              {deletePending ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      >
        {deleteError !== undefined && <p className={styles.modalError} role="alert">{deleteError}</p>}
      </Modal>
    </div>
  )
}

function SkillEditor({ open, creating, draft, cwd, groups, pending, submitError, t, onClose, onSave }: {
  open: boolean
  creating: boolean
  draft: EditorDraft
  cwd: string | undefined
  groups: readonly string[]
  pending: boolean
  submitError: string | undefined
  t: SkillsSectionInjected['t']
  onClose: () => void
  onSave: (draft: EditorDraft) => void
}) {
  const [form, setForm] = useState(draft)
  const [errors, setErrors] = useState<FieldErrors>({})
  useEffect(() => { setForm(draft); setErrors({}) }, [draft.name, open])

  const setField = <K extends keyof EditorDraft>(field: K, value: EditorDraft[K]): void => {
    setForm(current => ({ ...current, [field]: value }))
    if (field === 'name' || field === 'description' || field === 'content') {
      setErrors(current => ({ ...current, [field]: undefined }))
    }
  }
  const validate = (): FieldErrors => {
    const next: FieldErrors = {}
    if (!NAME.test(form.name)) next.name = t('nameRequired')
    if (form.description.trim().length === 0) next.description = t('descriptionRequired')
    if (form.content.trim().length === 0) next.content = t('contentRequired')
    return next
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? t('editorTitleAdd') : t('editorTitleEdit')}
      closeLabel={t('close')}
      {...styles.editorModal === undefined ? {} : { className: styles.editorModal }}
      {...styles.editorContent === undefined ? {} : { contentClassName: styles.editorContent }}
      footer={(
        <>
          <Button disabled={pending} onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => {
              const next = validate()
              setErrors(next)
              if (Object.values(next).some(Boolean)) return
              onSave(form)
            }}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </>
      )}
    >
      <div className={styles.form}>
        {creating && (
          <fieldset className={styles.scopeField}>
            <legend className={styles.label}>{t('scope')}</legend>
            <div className={styles.scopeOptions}>
              <Pill active={form.root === 'user-dsh'} aria-pressed={form.root === 'user-dsh'} onClick={() => { setField('root', 'user-dsh') }}>
                {t('scopeUser')}
              </Pill>
              <Pill
                active={form.root === 'project-dsh'}
                aria-pressed={form.root === 'project-dsh'}
                disabled={cwd === undefined}
                onClick={() => { setField('root', 'project-dsh') }}
              >
                {t('scopeProject')}
              </Pill>
            </div>
            {cwd === undefined && <span className={styles.fieldHint}>{t('projectUnavailable')}</span>}
            {cwd !== undefined && form.root === 'project-dsh' && <span className={styles.fieldHint}>{format(t('projectPath'), { cwd })}</span>}
          </fieldset>
        )}
        <label className={styles.field}>
          <span className={styles.label}>{t('name')}</span>
          <Input
            value={form.name}
            aria-label={t('name')}
            disabled={!creating || pending}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name === undefined ? undefined : 'skill-name-error'}
            onChange={(event) => { setField('name', event.target.value) }}
          />
          {errors.name !== undefined && <span id="skill-name-error" className={styles.fieldError}>{errors.name}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('description')}</span>
          <Input
            value={form.description}
            aria-label={t('description')}
            disabled={pending}
            aria-invalid={errors.description !== undefined}
            aria-describedby={errors.description === undefined ? undefined : 'skill-description-error'}
            onChange={(event) => { setField('description', event.target.value) }}
          />
          {errors.description !== undefined && <span id="skill-description-error" className={styles.fieldError}>{errors.description}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('whenToUse')}</span>
          <textarea
            className={styles.whenTextarea}
            aria-label={t('whenToUse')}
            value={form.whenToUse ?? ''}
            disabled={pending}
            onChange={(event) => { setField('whenToUse', event.target.value) }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('group')}</span>
          <GroupTagPicker
            selected={form.groups}
            disabled={pending}
            groups={groups}
            t={t}
            onChange={(groups) => { setField('groups', groups) }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('content')}</span>
          <textarea
            className={styles.textarea}
            aria-label={t('content')}
            value={form.content}
            disabled={pending}
            aria-invalid={errors.content !== undefined}
            aria-describedby={errors.content === undefined ? undefined : 'skill-content-error'}
            onChange={(event) => { setField('content', event.target.value) }}
          />
          {errors.content !== undefined && <span id="skill-content-error" className={styles.fieldError}>{errors.content}</span>}
        </label>
        <fieldset className={styles.invocationEditor} disabled={pending}>
          <legend className={styles.label}>{t('invocationTitle')}</legend>
          <label className={styles.switchRow}>
            <span>
              <span className={styles.switchLabel}>{t('model')}</span>
              <span className={styles.switchHint}>{t('modelHint')}</span>
            </span>
            <Switch checked={form.modelInvocable} onChange={(event: ChangeEvent<HTMLInputElement>) => { setField('modelInvocable', event.target.checked) }} />
          </label>
          <label className={styles.switchRow}>
            <span>
              <span className={styles.switchLabel}>{t('user')}</span>
              <span className={styles.switchHint}>{t('userHint')}</span>
            </span>
            <Switch checked={form.userInvocable} onChange={(event: ChangeEvent<HTMLInputElement>) => { setField('userInvocable', event.target.checked) }} />
          </label>
        </fieldset>
        {submitError !== undefined && <p className={styles.modalError} role="alert">{submitError}</p>}
      </div>
    </Modal>
  )
}

/**
 * Multi-select group tag picker: removable selected tags, a checkable dropdown
 * of catalog groups, and free-text entry (Enter or comma adds the typed label).
 * Toggling a dropdown row keeps the menu open; outside click, Escape, or the
 * trigger closes it. The clear-all row empties the selection (ungrouped).
 */
function GroupTagPicker({ selected, disabled, groups, t, onChange }: {
  selected: readonly string[]
  disabled: boolean
  groups: readonly string[]
  t: SkillsSectionInjected['t']
  onChange: (groups: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputBoxRef = useRef<HTMLSpanElement>(null)
  const getInputRect = useCallback(() => inputBoxRef.current?.getBoundingClientRect() ?? null, [])
  const known = new Set(groups)
  const typed = text.trim()
  const groupRows: MenuEntry[] = [
    ...groups.map(label => ({ id: label, label })),
    ...typed.length > 0 && !known.has(typed) ? [{ id: typed, label: typed }] : [],
  ]
  const items: MenuEntry[] = [
    ...groupRows,
    ...(groupRows.length > 0 ? [{ type: 'separator' as const, id: 'group-clear-separator' }] : []),
    { id: '', label: t('groupClearOption'), disabled: selected.length === 0 },
  ]
  return (
    // A flex wrapper blockifies the Menu's inline-flex root span, which
    // otherwise shrink-wraps the anchored row to its intrinsic width.
    <div className={styles.groupFieldShell}>
      <Menu
        open={open && !disabled}
        onClose={() => { setOpen(false) }}
        items={items}
        selectedIds={selected}
        onSelect={(id) => {
          if (id === '') {
            onChange([])
            return
          }
          onChange(toggleGroupLabel(selected, id))
        }}
        align="start"
        portal
        matchAnchorWidth
        getAnchorRect={getInputRect}
        anchor={(
          <div className={styles.groupField}>
            {selected.length > 0 && (
              <div className={styles.tagRow}>
                {selected.map(label => (
                  <span key={label} className={styles.tag}>
                    <Pill active>{label}</Pill>
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={format(t('groupRemoveFor'), { group: label })}
                      disabled={disabled}
                      onClick={() => { onChange(selected.filter(item => item !== label)) }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className={styles.groupFieldRow}>
              <span ref={inputBoxRef} className={styles.groupInputBox}>
                <Input
                  className={styles.groupInput}
                  value={text}
                  aria-label={t('group')}
                  placeholder={t('groupPlaceholder')}
                  disabled={disabled}
                  onChange={(event) => { setText(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ',') return
                    event.preventDefault()
                    const next = addGroupLabel(selected, text)
                    if (next !== undefined) onChange(next)
                    setText('')
                  }}
                />
              </span>
              <button
                type="button"
                className={styles.groupOptionsButton}
                aria-label={t('groupOptionsLabel')}
                aria-haspopup="menu"
                aria-expanded={open && !disabled}
                disabled={disabled}
                onClick={() => { setOpen(current => !current) }}
              >
                <IconChevronDownOutline14 />
              </button>
            </div>
          </div>
        )}
      />
    </div>
  )
}

function emptySkill(): EditorDraft {
  return {
    name: '',
    description: '',
    groups: [],
    root: 'user-dsh',
    modelInvocable: true,
    userInvocable: true,
    content: '',
  }
}

function editorDraft(detail: SkillInventoryDetail): EditorDraft {
  return {
    name: detail.name,
    description: detail.description,
    ...detail.whenToUse === undefined ? {} : { whenToUse: detail.whenToUse },
    groups: [...(detail.groups ?? [])],
    content: detail.content,
    root: detail.source === 'project-dsh' ? 'project-dsh' : 'user-dsh',
    modelInvocable: detail.modelInvocable,
    userInvocable: detail.userInvocable,
  }
}

/** One list section: a shared group label plus its rows. */
interface GroupSection {
  readonly group: string | undefined
  readonly skills: readonly SkillInventoryEntry[]
}

/**
 * Section rows by group label in first-appearance order; a skill repeats in
 * every one of its groups; ungrouped rows last.
 */
function groupSections(skills: readonly SkillInventoryEntry[]): readonly GroupSection[] {
  const byGroup = new Map<string, SkillInventoryEntry[]>()
  const ungrouped: SkillInventoryEntry[] = []
  for (const skill of skills) {
    const labels = skill.groups ?? []
    if (labels.length === 0) {
      ungrouped.push(skill)
      continue
    }
    for (const label of labels) {
      const existing = byGroup.get(label)
      if (existing === undefined) byGroup.set(label, [skill])
      else existing.push(skill)
    }
  }
  const sections: GroupSection[] = [...byGroup.entries()].map(([group, groupSkills]) => ({ group, skills: groupSkills }))
  if (ungrouped.length > 0) sections.push({ group: undefined, skills: ungrouped })
  return sections
}

/** Distinct non-empty group labels in first-appearance order across every skill. */
function distinctGroups(skills: readonly SkillInventoryEntry[]): readonly string[] {
  const seen = new Set<string>()
  const groups: string[] = []
  for (const skill of skills) {
    for (const label of skill.groups ?? []) {
      if (label.length === 0 || seen.has(label)) continue
      seen.add(label)
      groups.push(label)
    }
  }
  return groups
}

/** Add one typed label to the selection; undefined when the label is empty or already present. */
function addGroupLabel(selected: readonly string[], raw: string): string[] | undefined {
  const label = raw.trim()
  if (label.length === 0 || selected.includes(label)) return undefined
  return [...selected, label]
}

/** Toggle one label in the selection, preserving order. */
function toggleGroupLabel(selected: readonly string[], label: string): string[] {
  return selected.includes(label)
    ? selected.filter(item => item !== label)
    : [...selected, label]
}

/** Trim, drop empties, and dedupe group labels while keeping first-appearance order. */
function normalizeGroups(groups: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of groups) {
    const label = raw.trim()
    if (label.length === 0 || seen.has(label)) continue
    seen.add(label)
    normalized.push(label)
  }
  return normalized
}

/** sessionStorage key for per-group expand state. */
const TREE_STORAGE_KEY = 'dshd.settings.skills.tree'

/** Stable storage key for the ungrouped pseudo-section. */
const UNGROUPED_KEY = '\u0000ungrouped'

/** Storage key for one section: its label, or a reserved marker for ungrouped. */
function groupKeyOf(section: Pick<GroupSection, 'group'>): string {
  return section.group ?? UNGROUPED_KEY
}

/** Read remembered expand state; absent or corrupt storage yields defaults. */
function readTreeState(): Record<string, boolean> {
  /* v8 ignore next -- browser-only guard; jsdom and the app always provide sessionStorage */
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(TREE_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Persist remembered expand state; a failing write degrades to memory only. */
function persistTreeState(state: Readonly<Record<string, boolean>>): void {
  /* v8 ignore next -- browser-only guard; jsdom and the app always provide sessionStorage */
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(state))
    /* v8 ignore next -- setItem throws only on quota/security failure, untestable in jsdom */
  } catch {
    // Degrade to in-memory expand state.
  }
}

function skillKey(skill: Pick<SkillInventoryEntry, 'source' | 'name'>): string {
  return `${skill.source}:${skill.name}`
}

function sourceBucket(source: string): Exclude<SourceFilter, 'all'> {
  if (source === 'user-dsh' || source === 'user-agents') return 'user'
  if (source === 'project-dsh' || source === 'project-agents') return 'project'
  if (source === 'bundled') return 'bundled'
  return 'other'
}

function sourceLabel(source: string): SkillsSettingsKey {
  const bucket = sourceBucket(source)
  if (bucket === 'user') return 'sourceUser'
  if (bucket === 'project') return 'sourceProject'
  if (bucket === 'bundled') return 'sourceBundled'
  return 'sourceOther'
}

function matchesSource(skill: SkillInventoryEntry, filter: SourceFilter): boolean {
  return filter === 'all' || sourceBucket(skill.source) === filter
}

function format(template: string, vars: Record<string, string>): string {
  /* v8 ignore next -- every call site supplies the keys its template names */
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

function optionalWhenToUse(value: string | undefined): { whenToUse: string } | object {
  return value === undefined || value.trim().length === 0 ? {} : { whenToUse: value.trim() }
}
