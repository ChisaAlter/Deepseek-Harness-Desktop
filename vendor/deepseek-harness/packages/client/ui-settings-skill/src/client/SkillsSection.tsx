/**
 * Skills settings section: the management catalog over the host skill-admin
 * RPCs. Owned (user-root) skills carry edit and remove actions; every other
 * source renders read-only with its source badge. The create and edit flows
 * share one dialog; removal requires confirmation. The catalog is refetched
 * after every successful mutation, so the page converges with the filesystem
 * without waiting on a watcher.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SkillAdminView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { SkillForm } from './SkillForm.tsx'
import { messageOf } from './message.ts'
import type { en } from './locales.ts'
import styles from './SkillsSection.module.css'

/** Injected dependencies of {@link SkillsSection} (slot `inject`). */
export interface SkillsSectionInjected {
  /** Wire face for the skill-management RPCs. */
  api: Pick<IApiClient, 'skills'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type SkillsSectionProps = Partial<SkillsSectionInjected>

/** The shared create/edit dialog's open state. */
interface FormState {
  mode: 'create' | 'edit'
  /** Edit preload: the stored entry and body. */
  entry?: SkillAdminView
  content?: string
}

/** One pending removal with its in-flight and failure state. */
interface DeleteState {
  entry: SkillAdminView
  busy: boolean
  failure: string | undefined
}

/**
 * Render the Skills section, guarded until the shell supplies the inject face.
 * @param props - injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { api, t } = props
  if (api === undefined || t === undefined) return null
  return <Loaded api={api} t={t} />
}

/** The loaded section body. */
function Loaded({ api, t }: SkillsSectionInjected): ReactNode {
  const [entries, setEntries] = useState<readonly SkillAdminView[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [form, setForm] = useState<FormState | undefined>(undefined)
  const [deleting, setDeleting] = useState<DeleteState | undefined>(undefined)

  useEffect(() => {
    let stale = false
    void (async () => {
      try {
        const response = await api.skills.catalog({})
        if (stale) return
        if (!response.result.ok) {
          setFailure(t('loadFailed'))
          return
        }
        setEntries(response.result.value.skills)
        setFailure(undefined)
      } catch {
        // A transport failure rejects rather than answering; without this the
        // page would stay blank with no error shown.
        if (!stale) setFailure(t('loadFailed'))
      }
    })()
    return () => { stale = true }
  }, [api.skills, t])

  const load = async (): Promise<void> => {
    try {
      const response = await api.skills.catalog({})
      if (!response.result.ok) {
        setFailure(t('loadFailed'))
        return
      }
      setEntries(response.result.value.skills)
      setFailure(undefined)
    } catch {
      setFailure(t('loadFailed'))
    }
  }

  const openEdit = async (entry: SkillAdminView): Promise<void> => {
    try {
      const response = await api.skills.read({ name: entry.name })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setForm({ mode: 'edit', entry: response.result.value.entry, content: response.result.value.content })
      setFailure(undefined)
    } catch (error) {
      setFailure(messageOf(error))
    }
  }

  const onFormClose = (changed: boolean): void => {
    setForm(undefined)
    if (changed) void load()
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleting === undefined) return
    setDeleting({ ...deleting, busy: true, failure: undefined })
    try {
      const response = await api.skills.remove({ name: deleting.entry.name })
      if (!response.result.ok) {
        setDeleting({ ...deleting, busy: false, failure: response.result.error.message })
        return
      }
      setDeleting(undefined)
      void load()
    } catch (error) {
      setDeleting({ ...deleting, busy: false, failure: messageOf(error) })
    }
  }

  const owned = (entries ?? []).filter(entry => entry.owned)
  const others = (entries ?? []).filter(entry => !entry.owned)

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      <div className={styles['headRow']}>
        <Button variant="outline" onClick={() => { setForm({ mode: 'create' }) }}>{t('create')}</Button>
      </div>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {entries === undefined
        ? <p className={styles['notice']}>{t('loading')}</p>
        : (
          <>
            <Group
              title={t('groupUser')}
              entries={owned}
              empty={t('empty')}
              t={t}
              onEdit={(entry) => { void openEdit(entry) }}
              onDelete={(entry) => { setDeleting({ entry, busy: false, failure: undefined }) }}
            />
            <Group
              title={t('groupOthers')}
              entries={others}
              empty={t('emptyOthers')}
              t={t}
            />
          </>
        )}
      {form !== undefined
        ? (
          <SkillForm
            mode={form.mode}
            {...form.entry === undefined ? {} : { initial: form.entry }}
            {...form.content === undefined ? {} : { initialContent: form.content }}
            api={api}
            t={t}
            onClose={onFormClose}
          />
        )
        : null}
      {deleting !== undefined
        ? (
          <Modal
            open
            onClose={() => { if (!deleting.busy) setDeleting(undefined) }}
            title={t('deleteTitle')}
            closeLabel={t('close')}
            description={t('deleteDescription')}
            className={styles['dialog'] as string}
            footer={(
              <>
                <Button variant="outline" disabled={deleting.busy} onClick={() => { setDeleting(undefined) }}>
                  {t('cancel')}
                </Button>
                <Button variant="outline" disabled={deleting.busy} onClick={() => { void confirmDelete() }}>
                  {deleting.busy ? t('deleting') : t('deleteConfirm')}
                </Button>
              </>
            )}
          >
            {deleting.failure !== undefined ? <p className={styles['error']}>{deleting.failure}</p> : null}
          </Modal>
        )
        : null}
    </div>
  )
}

/** One catalog group: a titled row list with ownership-gated actions. */
function Group(props: {
  title: string
  entries: readonly SkillAdminView[]
  empty: string
  t: (key: keyof typeof en) => string
  onEdit?: (entry: SkillAdminView) => void
  onDelete?: (entry: SkillAdminView) => void
}): ReactNode {
  const { title, entries, empty, t, onEdit, onDelete } = props
  return (
    <section className={styles['group']} aria-label={title}>
      <h3 className={styles['groupTitle']}>{title}</h3>
      {entries.length === 0 ? <p className={styles['empty']}>{empty}</p> : null}
      <ul className={styles['rows']}>
        {entries.map(entry => (
          <li key={`${entry.source}:${entry.name}`} className={styles['row']}>
            <div className={styles['rowMain']}>
              <span className={styles['rowName']}>{entry.name}</span>
              <span className={styles['rowDesc']}>{entry.description}</span>
              <span className={styles['badge']}>{t('sourceBadge').replace('{source}', entry.source)}</span>
            </div>
            {entry.owned && onEdit !== undefined && onDelete !== undefined
              ? (
                <div className={styles['rowActions']}>
                  <button type="button" className={styles['linkButton']} onClick={() => { onEdit(entry) }}>
                    {t('edit')}
                  </button>
                  <button type="button" className={styles['linkButtonDanger']} onClick={() => { onDelete(entry) }}>
                    {t('remove')}
                  </button>
                </div>
              )
              : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
