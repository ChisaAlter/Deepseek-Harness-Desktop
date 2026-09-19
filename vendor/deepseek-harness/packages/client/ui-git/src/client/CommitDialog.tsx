/**
 * Commit review dialog: branch, file list with +/- stats,
 * optional message, and Commit / Commit on new branch.
 * @module @deepseek-ai/dsh-client-ui-git/client/CommitDialog
 */

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './CommitDialog.module.css'

/** One changed path with numstat counts. */
export interface CommitFileRow {
  path: string
  insertions: number
  deletions: number
}

/** Large-file warning entry from the host. */
export interface LargeFileWarning {
  path: string
  size: number
}

/** Props for the commit review dialog. */
export interface CommitDialogProps {
  open: boolean
  branchName: string | null
  isDefaultRef: boolean
  files: readonly CommitFileRow[]
  excluded: ReadonlySet<string>
  editing: boolean
  message: string
  t: PropsLocale<typeof NS>['t']
  largeFiles?: readonly LargeFileWarning[]
  onClose: () => void
  onMessage: (value: string) => void
  onToggleEdit: () => void
  onTogglePath: (path: string) => void
  onToggleAll: () => void
  onCommit: () => void
  onCommitNewRef: () => void
  onOpenFile?: (path: string) => void
}

/** Format bytes as MB for the warning banner. */
function formatMb(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Render the commit review dialog.
 * @param props - open state, files, copy, and callbacks.
 * @returns the modal.
 */
export function CommitDialog({
  open, branchName, isDefaultRef, files, excluded, editing, message, t, largeFiles,
  onClose, onMessage, onToggleEdit, onTogglePath, onToggleAll, onCommit, onCommitNewRef, onOpenFile,
}: CommitDialogProps) {
  const selected = files.filter(file => !excluded.has(file.path))
  const noneSelected = selected.length === 0
  const allSelected = files.length > 0 && selected.length === files.length
  const insertions = selected.reduce((sum, file) => sum + file.insertions, 0)
  const deletions = selected.reduce((sum, file) => sum + file.deletions, 0)
  const hasLargeFiles = Array.isArray(largeFiles) && largeFiles.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('commit.title')}
      closeLabel={t('commit.cancel')}
      description={t('commit.description')}
      className={css.dialog}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('commit.cancel')}
          </Button>
          <Button variant="outline" size="sm" disabled={noneSelected} onClick={onCommitNewRef}>
            {t('commit.onNewRef')}
          </Button>
          <Button variant="primary" size="sm" disabled={noneSelected} onClick={onCommit}>
            {t('commit.submit')}
          </Button>
        </>
      )}
    >
      <div className={css.review}>
        <div className={css.branchRow}>
          <span className={css.meta}>{t('commit.branch')}</span>
          <span className={css.branchName}>{branchName ?? t('commit.detached')}</span>
          {isDefaultRef && <span className={css.warn}>{t('commit.defaultWarning')}</span>}
        </div>
        {hasLargeFiles && (
          <div className={css.warningBanner} role="alert">
            <span className={css.warningTitle}>{t('commit.largeFileWarning')}</span>
            <ul className={css.warningList}>
              {largeFiles.map(file => (
                <li key={file.path} className={css.warningItem}>
                  <span className={css.warningPath}>{file.path}</span>
                  <span className={css.warningSize}>{formatMb(file.size)}</span>
                </li>
              ))}
            </ul>
            <span className={css.warningHint}>{t('commit.largeFileHint')}</span>
          </div>
        )}
        <div className={css.filesHead}>
          <div className={css.filesLabel}>
            {editing && files.length > 0 && (
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && !noneSelected
                }}
                aria-label={t('commit.files')}
                onChange={onToggleAll}
              />
            )}
            <span className={css.meta}>{t('commit.files')}</span>
            {!allSelected && !editing && files.length > 0 && (
              <span className={css.meta}>
                ({t('commit.selectedOf', { selected: String(selected.length), total: String(files.length) })})
              </span>
            )}
          </div>
          {files.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onToggleEdit}>
              {editing ? t('commit.done') : t('commit.edit')}
            </Button>
          )}
        </div>
        {files.length === 0
          ? <p className={css.none}>{t('commit.none')}</p>
          : (
            <>
              <ul className={css.list}>
                {files.map(file => {
                  const isExcluded = excluded.has(file.path)
                  return (
                    <li key={file.path} className={css.row}>
                      {editing && (
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          aria-label={file.path}
                          onChange={() => { onTogglePath(file.path) }}
                        />
                      )}
                      {onOpenFile
                        ? (
                          <button
                            type="button"
                            className={css.pathButton}
                            onClick={() => { onOpenFile(file.path) }}
                          >
                            {file.path}
                          </button>
                        )
                        : <span className={isExcluded ? css.pathMuted : css.path}>{file.path}</span>}
                      {isExcluded
                        ? <span className={css.meta}>{t('commit.excluded')}</span>
                        : (
                          <span className={css.stat}>
                            <span className={css.add}>+{file.insertions}</span>
                            <span className={css.meta}> / </span>
                            <span className={css.del}>-{file.deletions}</span>
                          </span>
                        )}
                    </li>
                  )
                })}
              </ul>
              <div className={css.total}>
                <span className={css.add}>+{insertions}</span>
                <span className={css.meta}> / </span>
                <span className={css.del}>-{deletions}</span>
              </div>
            </>
          )}
      </div>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('commit.message')}</span>
        <textarea
          className={css.message}
          value={message}
          placeholder={t('commit.placeholder')}
          onChange={(event) => { onMessage(event.target.value) }}
        />
      </label>
    </Modal>
  )
}