/**
 * The create/edit MCP server dialog: transport selection with per-transport
 * field sets, client-side gates mirroring the host grammar, and two actions —
 * save (settings.mutate path ops) and test connection (a one-shot probe that
 * mounts nothing). The host's own validation stays the authority; its
 * refusals are shown inline.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, McpProbeRequestView, McpProbeResultView, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { messageOf } from './message.ts'
import type { en } from './locales.ts'
import styles from './McpSection.module.css'

/** The serverName grammar the host enforces. */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** A stored or drafted server profile as the wire types spell it. */
export type McpProfileDraft = McpProbeRequestView

/** The form's editable state, split into text buffers. */
export interface McpServerDraft {
  name: string
  transport: 'stdio' | 'streamable-http'
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  timeoutText: string
}

/** A stored profile's editable fields, or undefined when the stored value is not a profile. */
export function draftOf(initialName: string, stored: unknown): McpServerDraft {
  const value = typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {}
  const transport = value.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const stringField = (key: string): string => {
    const raw = value[key]
    return typeof raw === 'string' ? raw : ''
  }
  return {
    name: initialName,
    transport,
    command: transport === 'stdio' ? stringField('command') : '',
    argsText: linesOf(value.args),
    envText: linesOf(value.env),
    cwd: transport === 'stdio' ? stringField('cwd') : '',
    url: transport === 'streamable-http' ? stringField('url') : '',
    headersText: linesOf(value.headers),
    timeoutText: typeof value.toolCallTimeoutMs === 'number' ? String(value.toolCallTimeoutMs) : '',
  }
}

/** Spell a stored list (or dict) as one value per line. */
function linesOf(field: unknown): string {
  if (typeof field !== 'object' || field === null) return ''
  return Object.values(field as Record<string, string>).join('\n')
}

/** Build the wire profile from the draft; empties are dropped. */
export function profileOf(draft: McpServerDraft): McpProbeRequestView {
  const timeout = draft.timeoutText.trim().length === 0
    ? undefined
    : Number(draft.timeoutText.trim())
  const base = {
    serverName: draft.name,
    ...timeout !== undefined && Number.isInteger(timeout) && timeout > 0 ? { toolCallTimeoutMs: timeout } : {},
  }
  if (draft.transport === 'stdio') {
    const args = splitLines(draft.argsText)
    const env = parsePairs(draft.envText, '=')
    return {
      ...base,
      transport: 'stdio',
      command: draft.command,
      ...args.length > 0 ? { args } : {},
      ...env === undefined ? {} : { env },
      ...draft.cwd.trim().length > 0 ? { cwd: draft.cwd.trim() } : {},
    }
  }
  const headers = parsePairs(draft.headersText, ':')
  return {
    ...base,
    transport: 'streamable-http',
    url: draft.url,
    ...headers === undefined ? {} : { headers },
  }
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
}

/** Parse KEY=VALUE (or Key: Value) lines; malformed lines are dropped. */
function parsePairs(text: string, separator: string): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const line of splitLines(text)) {
    const index = line.indexOf(separator)
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key.length > 0) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Props of {@link McpServerForm}. */
export interface McpServerFormProps {
  /** Whether the dialog creates a new server or edits an existing one. */
  mode: 'create' | 'edit'
  /** Edit preload: the server name; create mode may type it. */
  initialName?: string
  /** Edit preload: the stored profile. */
  initial?: unknown
  /** Wire faces for the save and the test-connection probe. */
  api: Pick<IApiClient, 'settings' | 'mcp'>
  /** The `mcp` settings namespace view the write is judged against. */
  namespace: SettingsNamespaceView
  /** Dialog copy. */
  t: (key: keyof typeof en) => string
  /** Close the dialog; `changed` reports whether a save committed. */
  onClose: (changed: boolean) => void
}

/**
 * Render the create/edit MCP server dialog.
 * @param props - mode, optional preload, wire faces, namespace view, copy, and close callback.
 * @returns the dialog.
 */
export function McpServerForm(props: McpServerFormProps): ReactNode {
  const { mode, initialName, initial, api, namespace, t, onClose } = props
  const [draft, setDraft] = useState<McpServerDraft>(() => draftOf(initialName ?? '', initial))
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<McpProbeResultView | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const nameInvalid = draft.name.length > 0 && !NAME_PATTERN.test(draft.name)
  const commandMissing = draft.transport === 'stdio' && draft.command.trim().length === 0
  const urlMissing = draft.transport === 'streamable-http' && draft.url.trim().length === 0
  const ready = draft.name.length > 0 && !nameInvalid && !commandMissing && !urlMissing && !busy

  const setField = (key: keyof McpServerDraft, value: string): void => {
    setDraft(current => ({ ...current, [key]: value }))
    setProbeResult(undefined)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.settings.mutate({
        ns: namespace.ns,
        ops: [{ op: 'set', path: ['servers', draft.name], value: profileOf(draft) }],
        expectedRevision: namespace.revision,
      })
      if (!response.result.ok) {
        setFailure(response.result.error.code === 'settings-conflict'
          ? t('conflict')
          : response.result.error.message)
        return
      }
      onClose(true)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const probe = async (): Promise<void> => {
    setProbing(true)
    setProbeResult(undefined)
    try {
      const response = await api.mcp.probe(profileOf(draft))
      setProbeResult(response.result.ok
        ? response.result.value
        : { ok: false, message: response.result.error.message })
    } catch (error) {
      setProbeResult({ ok: false, message: messageOf(error) })
    } finally {
      setProbing(false)
    }
  }

  const timeoutInvalid = draft.timeoutText.trim().length > 0
    && (!Number.isInteger(Number(draft.timeoutText.trim())) || Number(draft.timeoutText.trim()) <= 0)

  return (
    <Modal
      open
      onClose={() => { if (!busy && !probing) onClose(false) }}
      title={mode === 'create' ? t('add') : t('editTitle')}
      closeLabel={t('close')}
      className={styles['dialog'] as string}
      footer={(
        <>
          <Button variant="outline" disabled={busy || probing} onClick={() => { onClose(false) }}>{t('cancel')}</Button>
          <Button variant="outline" disabled={busy || probing} onClick={() => { void probe() }}>
            {probing ? t('probing') : t('probe')}
          </Button>
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
            value={draft.name}
            aria-label={t('name')}
            aria-invalid={nameInvalid}
            disabled={busy || probing || mode === 'edit'}
            onChange={(event) => { setField('name', event.target.value) }}
          />
          {nameInvalid ? <span className={styles['fieldError']}>{t('nameInvalid')}</span> : null}
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('transport')}</span>
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            value={draft.transport}
            aria-label={t('transport')}
            disabled={busy || probing}
            onChange={(event) => {
              setDraft(current => ({ ...current, transport: event.target.value as 'stdio' | 'streamable-http' }))
              setProbeResult(undefined)
            }}
          >
            <option value="stdio">{t('transportStdio')}</option>
            <option value="streamable-http">{t('transportHttp')}</option>
          </select>
        </label>
        {draft.transport === 'stdio'
          ? (
            <>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('command')}</span>
                <input
                  className={styles['input']}
                  type="text"
                  value={draft.command}
                  aria-label={t('command')}
                  aria-invalid={commandMissing}
                  disabled={busy || probing}
                  onChange={(event) => { setField('command', event.target.value) }}
                />
                {commandMissing ? <span className={styles['fieldError']}>{t('commandRequired')}</span> : null}
              </label>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('args')}</span>
                <textarea
                  className={`${styles['input']} ${styles['listInput']}`}
                  value={draft.argsText}
                  aria-label={t('args')}
                  disabled={busy || probing}
                  onChange={(event) => { setField('argsText', event.target.value) }}
                />
              </label>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('env')}</span>
                <textarea
                  className={`${styles['input']} ${styles['listInput']}`}
                  value={draft.envText}
                  aria-label={t('env')}
                  disabled={busy || probing}
                  onChange={(event) => { setField('envText', event.target.value) }}
                />
              </label>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('cwd')}</span>
                <input
                  className={styles['input']}
                  type="text"
                  value={draft.cwd}
                  aria-label={t('cwd')}
                  disabled={busy || probing}
                  onChange={(event) => { setField('cwd', event.target.value) }}
                />
              </label>
            </>
          )
          : (
            <>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('url')}</span>
                <input
                  className={styles['input']}
                  type="text"
                  value={draft.url}
                  aria-label={t('url')}
                  aria-invalid={urlMissing}
                  disabled={busy || probing}
                  onChange={(event) => { setField('url', event.target.value) }}
                />
                {urlMissing ? <span className={styles['fieldError']}>{t('urlRequired')}</span> : null}
              </label>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('headers')}</span>
                <textarea
                  className={`${styles['input']} ${styles['listInput']}`}
                  value={draft.headersText}
                  aria-label={t('headers')}
                  disabled={busy || probing}
                  onChange={(event) => { setField('headersText', event.target.value) }}
                />
              </label>
            </>
          )}
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('timeout')}</span>
          <input
            className={styles['input']}
            type="text"
            inputMode="numeric"
            value={draft.timeoutText}
            aria-label={t('timeout')}
            aria-invalid={timeoutInvalid}
            disabled={busy || probing}
            onChange={(event) => { setField('timeoutText', event.target.value) }}
          />
        </label>
        {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
        {probeResult !== undefined
          ? (
            <div className={styles['probeResult']}>
              <span className={styles['probeTitle']}>{t('probeTitle')}</span>
              {probeResult.ok
                ? (
                  <span className={styles['probeOk']}>
                    {t('probeTools').replace('{count}', String(probeResult.tools.length))}
                  </span>
                )
                : (
                  <span className={styles['error']}>
                    {`${t('probeFailed')}: ${probeResult.message}`}
                  </span>
                )}
            </div>
          )
          : null}
      </div>
    </Modal>
  )
}
