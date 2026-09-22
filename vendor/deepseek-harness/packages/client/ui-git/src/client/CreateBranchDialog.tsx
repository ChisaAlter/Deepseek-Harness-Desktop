/**
 * Create-and-checkout dialog: name a new local branch from current HEAD.
 * @module @deepseek-ai/dsh-client-ui-git/client/CreateBranchDialog
 */

import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './CreateBranchDialog.module.css'

/** Props for the create-branch dialog. */
export interface CreateBranchDialogProps {
  open: boolean
  name: string
  taken: boolean
  t: PropsLocale<typeof NS>['t']
  onClose: () => void
  onName: (value: string) => void
  onSubmit: () => void
}

/**
 * Render the create-and-checkout dialog.
 * @param props - open state, draft name, copy, and callbacks.
 * @returns the modal.
 */
export function CreateBranchDialog({
  open, name, taken, t, onClose, onName, onSubmit,
}: CreateBranchDialogProps) {
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !taken

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('branch.createTitle')}
      closeLabel={t('branch.createCancel')}
      description={t('branch.createDescription')}
      className={css.dialog}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('branch.createCancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {t('branch.createSubmit')}
          </Button>
        </>
      )}
    >
      <label className={css.field}>
        <span className={css.label}>{t('branch.createName')}</span>
        <Input
          className={css.input}
          value={name}
          placeholder={t('branch.createPlaceholder')}
          autoFocus
          aria-label={t('branch.createName')}
          onChange={(event) => { onName(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) onSubmit()
          }}
        />
        <span className={css.note}>{t('branch.createNote')}</span>
      </label>
    </Modal>
  )
}
