/**
 * Publish a local repo: gh repo create, or add a remote URL and push.
 * @module @deepseek-ai/dsh-client-ui-git/client/PublishDialog
 */

import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './PublishDialog.module.css'

/** Values the publish dialog submits. */
export interface PublishDialogValues {
  name: string
  visibility: 'public' | 'private'
  remoteUrl: string
}

/** Props for the publish dialog. */
export interface PublishDialogProps {
  open: boolean
  name: string
  visibility: 'public' | 'private'
  remoteUrl: string
  t: PropsLocale<typeof NS>['t']
  onClose: () => void
  onName: (value: string) => void
  onVisibility: (value: 'public' | 'private') => void
  onRemoteUrl: (value: string) => void
  onSubmit: () => void
}

/**
 * Render the publish-repository dialog.
 * @param props - draft fields, copy, and callbacks.
 * @returns the modal.
 */
export function PublishDialog({
  open, name, visibility, remoteUrl, t, onClose, onName, onVisibility, onRemoteUrl, onSubmit,
}: PublishDialogProps) {
  const canSubmit = name.trim().length > 0 || remoteUrl.trim().length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('publish.title')}
      closeLabel={t('publish.cancel')}
      description={t('publish.description')}
      className={css.dialog}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('publish.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={onSubmit}>
            {t('publish.submit')}
          </Button>
        </>
      )}
    >
      <label className={css.field}>
        <span className={css.label}>{t('publish.name')}</span>
        <Input
          className={css.input}
          value={name}
          aria-label={t('publish.name')}
          onChange={(event) => { onName(event.target.value) }}
        />
      </label>
      <fieldset className={css.field}>
        <legend className={css.label}>{t('publish.visibility')}</legend>
        <div className={css.row}>
          <Button
            variant={visibility === 'public' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => { onVisibility('public') }}
          >
            {t('publish.public')}
          </Button>
          <Button
            variant={visibility === 'private' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => { onVisibility('private') }}
          >
            {t('publish.private')}
          </Button>
        </div>
      </fieldset>
      <label className={css.field}>
        <span className={css.label}>{t('publish.remoteUrl')}</span>
        <Input
          className={css.input}
          value={remoteUrl}
          placeholder={t('publish.remotePlaceholder')}
          aria-label={t('publish.remoteUrl')}
          onChange={(event) => { onRemoteUrl(event.target.value) }}
        />
        <span className={css.note}>{t('publish.note')}</span>
      </label>
    </Modal>
  )
}
