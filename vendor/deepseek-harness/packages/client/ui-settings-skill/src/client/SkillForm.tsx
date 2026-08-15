/**
 * The create/edit skill dialog: name, description, optional when-to-use,
 * markdown body, and the two invocation switches. Client-side gates mirror
 * the host grammar (kebab-case name, non-empty description); the host's own
 * validation stays the authority and its refusal is shown inline.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SkillAdminView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { messageOf } from './message.ts'
import type { en } from './locales.ts'
import styles from './SkillsSection.module.css'

/** The skill-name grammar the host enforces (`isSkillName`). */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Props of {@link SkillForm}. */
export interface SkillFormProps {
  /** Whether the dialog creates a new skill or edits an existing one. */
  mode: 'create' | 'edit'
  /** Edit preload: the stored entry; create mode omits it. */
  initial?: SkillAdminView
  /** Edit preload: the stored body. */
  initialContent?: string
  /** Wire face for the save call. */
  api: Pick<IApiClient, 'skills'>
  /** Dialog copy. */
  t: (key: keyof typeof en) => string
  /** Close the dialog; `changed` reports whether a save committed. */
  onClose: (changed: boolean) => void
}

/**
 * Render the create/edit skill dialog.
 * @param props - mode, optional preload, wire face, copy, and close callback.
 * @returns the dialog.
 */
export function SkillForm(props: SkillFormProps): ReactNode {
  const { mode, initial, initialContent, api, t, onClose } = props
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [whenToUse, setWhenToUse] = useState(initial?.whenToUse ?? '')
  const [content, setContent] = useState(initialContent ?? '')
  const [modelInvocable, setModelInvocable] = useState(initial?.modelInvocable ?? true)
  const [userInvocable, setUserInvocable] = useState(initial?.userInvocable ?? true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const nameInvalid = name.length > 0 && !NAME_PATTERN.test(name)
  const ready = name.length > 0 && !nameInvalid && description.trim().length > 0 && !busy

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.skills.save({
        name,
        description: description.trim(),
        ...whenToUse.trim().length > 0 ? { whenToUse: whenToUse.trim() } : {},
        content,
        modelInvocable,
        userInvocable,
      })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // dialog would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(false) }}
      title={mode === 'create' ? t('create') : t('editTitle')}
      closeLabel={t('close')}
      className={styles['dialog'] as string}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={() => { onClose(false) }}>{t('cancel')}</Button>
          <Button variant="outline" disabled={!ready} onClick={() => { void save() }}>
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      )}
    >
      <div className={styles['form']}>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('name')}</span>
          <input
            className={styles['input']}
            type="text"
            value={name}
            aria-label={t('name')}
            aria-invalid={nameInvalid}
            disabled={busy}
            onChange={(event) => { setName(event.target.value) }}
          />
          {nameInvalid ? <span className={styles['fieldError']}>{t('nameInvalid')}</span> : null}
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('description')}</span>
          <input
            className={styles['input']}
            type="text"
            value={description}
            aria-label={t('description')}
            disabled={busy}
            onChange={(event) => { setDescription(event.target.value) }}
          />
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('whenToUse')}</span>
          <input
            className={styles['input']}
            type="text"
            value={whenToUse}
            aria-label={t('whenToUse')}
            disabled={busy}
            onChange={(event) => { setWhenToUse(event.target.value) }}
          />
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('content')}</span>
          <textarea
            className={`${styles['input']} ${styles['contentInput']}`}
            value={content}
            aria-label={t('content')}
            disabled={busy}
            onChange={(event) => { setContent(event.target.value) }}
          />
        </label>
        <div className={styles['switchRow']}>
          <label className={styles['switchOption']}>
            <input
              type="checkbox"
              checked={modelInvocable}
              aria-label={t('modelInvocable')}
              disabled={busy}
              onChange={(event) => { setModelInvocable(event.target.checked) }}
            />
            <span>{t('modelInvocable')}</span>
          </label>
          <label className={styles['switchOption']}>
            <input
              type="checkbox"
              checked={userInvocable}
              aria-label={t('userInvocable')}
              disabled={busy}
              onChange={(event) => { setUserInvocable(event.target.checked) }}
            />
            <span>{t('userInvocable')}</span>
          </label>
        </div>
        {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      </div>
    </Modal>
  )
}
