/**
 * MCP servers settings section: the `mcp` settings namespace rendered with
 * live connection status. Rows show the transport family and the latest
 * supervised phase; owned actions probe (one-shot, mounts nothing), edit, and
 * remove (immediate disconnect). The status list polls while the page is
 * mounted so connection changes surface without a restart.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient,
  McpProbeRequestView,
  McpProbeResultView,
  McpServerStatusView,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { McpServerForm } from './McpServerForm.tsx'
import { messageOf } from './message.ts'
import type { en } from './locales.ts'
import styles from './McpSection.module.css'

/** Injected dependencies of {@link McpSection} (slot `inject`). */
export interface McpSectionInjected {
  /** Wire faces for the settings seam and the live status/probe RPCs. */
  api: Pick<IApiClient, 'settings' | 'mcp'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type McpSectionProps = Partial<McpSectionInjected>

/** The shared create/edit dialog's open state. */
interface FormState {
  mode: 'create' | 'edit'
  name?: string
}

/** One pending removal with its in-flight state. */
interface DeleteState {
  name: string
  busy: boolean
  failure?: string
}

/** One stored server row joined with its live status. */
interface ServerRow {
  name: string
  profile: McpProbeRequestView | undefined
  status: McpServerStatusView['status'] | undefined
}

const POLL_INTERVAL_MS = 3_000

const STATUS_KEYS = {
  connecting: 'statusConnecting',
  connected: 'statusConnected',
  reconnecting: 'statusReconnecting',
  error: 'statusError',
  disposed: 'statusDisposed',
} as const satisfies Record<string, keyof typeof en>

/**
 * Render the MCP servers section, guarded until the shell supplies the inject
 * face.
 * @param props - injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function McpSection(props: McpSectionProps): ReactNode {
  const { api, t } = props
  if (api === undefined || t === undefined) return null
  return <Loaded api={api} t={t} />
}

/** The loaded section body. */
function Loaded({ api, t }: McpSectionInjected): ReactNode {
  const [namespace, setNamespace] = useState<SettingsNamespaceView | undefined>(undefined)
  const [statuses, setStatuses] = useState<readonly McpServerStatusView[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [form, setForm] = useState<FormState | undefined>(undefined)
  const [deleting, setDeleting] = useState<DeleteState | undefined>(undefined)
  const [probeResult, setProbeResult] = useState<McpProbeResultView | undefined>(undefined)

  const loadSettings = async (): Promise<void> => {
    try {
      const response = await api.settings.describe({})
      if (!response.result.ok) {
        setFailure(t('loadFailed'))
        return
      }
      const mcp = response.result.value.namespaces.find(view => view.ns === 'mcp')
      if (mcp === undefined) {
        setFailure(t('loadFailed'))
        return
      }
      setNamespace(mcp)
      setFailure(undefined)
    } catch (error) {
      setFailure(t('loadFailed'))
    }
  }

  const loadStatuses = async (): Promise<void> => {
    try {
      const response = await api.mcp.describe({})
      if (response.result.ok) setStatuses(response.result.value.servers)
    } catch {
      // Status is advisory; a transport failure must not clear the page.
    }
  }

  useEffect(() => {
    let stale = false
    void (async () => {
      await loadSettings()
      await loadStatuses()
      if (stale) return
      const timer = setInterval(() => { void loadStatuses() }, POLL_INTERVAL_MS)
      return () => { clearInterval(timer) }
    })().then(() => undefined, () => undefined)
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per mount; the poll owns freshness
  }, [])

  const servers: ServerRow[] = (() => {
    const stored = namespace === undefined ? undefined : getPath(namespace.user, ['servers'])
    const entries = typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? Object.entries(stored as Record<string, unknown>)
      : []
    return entries.map(([name, value]) => {
      const status = statuses.find(view => view.serverName === name)?.status
      const profile = probeProfileOf(name, value)
      return { name, profile, status }
    })
  })()

  const onFormClose = (changed: boolean): void => {
    setForm(undefined)
    if (changed) void loadSettings()
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleting === undefined || namespace === undefined) return
    setDeleting({ ...deleting, busy: true })
    try {
      const response = await api.settings.mutate({
        ns: namespace.ns,
        ops: [{ op: 'unset', path: ['servers', deleting.name] }],
        expectedRevision: namespace.revision,
      })
      if (!response.result.ok) {
        setDeleting({ ...deleting, busy: false, failure: response.result.error.message })
        return
      }
      setDeleting(undefined)
      void loadSettings()
    } catch (error) {
      setDeleting({ ...deleting, busy: false, failure: messageOf(error) })
    }
  }

  const probeServer = async (row: ServerRow): Promise<void> => {
    if (row.profile === undefined) return
    try {
      const response = await api.mcp.probe(row.profile)
      setProbeResult(response.result.ok
        ? response.result.value
        : { ok: false, message: response.result.error.message })
    } catch (error) {
      setProbeResult({ ok: false, message: messageOf(error) })
    }
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      <div className={styles['headRow']}>
        <Button variant="outline" onClick={() => { setForm({ mode: 'create' }) }}>{t('add')}</Button>
      </div>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {servers.length === 0 ? <p className={styles['empty']}>{t('empty')}</p> : null}
      <ul className={styles['rows']}>
        {servers.map(row => (
          <li key={row.name} className={styles['row']}>
            <div className={styles['rowMain']}>
              <span className={styles['rowName']}>{row.name}</span>
              <span className={styles['badge']}>
                {row.profile?.transport === 'streamable-http' ? t('transportHttp') : t('transportStdio')}
              </span>
              {row.status !== undefined
                ? (
                  <span className={styles['statusLine']}>
                    <span className={`${styles['statusDot']} ${styles[`statusDot_${row.status.phase}`]}`} aria-hidden />
                    {t(STATUS_KEYS[row.status.phase] ?? 'statusUnknown')}
                    {row.status.error !== undefined ? <span className={styles['statusError']}>{row.status.error}</span> : null}
                  </span>
                )
                : null}
            </div>
            <div className={styles['rowActions']}>
              <button
                type="button"
                className={styles['linkButton']}
                disabled={row.profile === undefined}
                onClick={() => { void probeServer(row) }}
              >
                {t('probe')}
              </button>
              <button
                type="button"
                className={styles['linkButton']}
                onClick={() => { setForm({ mode: 'edit', name: row.name }) }}
              >
                {t('edit')}
              </button>
              <button
                type="button"
                className={styles['linkButtonDanger']}
                onClick={() => { setDeleting({ name: row.name, busy: false }) }}
              >
                {t('remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {form !== undefined && namespace !== undefined
        ? (
          <McpServerForm
            mode={form.mode}
            {...form.name === undefined ? {} : { initialName: form.name }}
            {...form.name === undefined
              ? {}
              : { initial: getPath(namespace.user, ['servers', form.name]) }}
            api={api}
            namespace={namespace}
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
      {probeResult !== undefined
        ? (
          <Modal
            open
            onClose={() => { setProbeResult(undefined) }}
            title={t('probeTitle')}
            closeLabel={t('close')}
            className={styles['dialog'] as string}
            footer={<Button variant="outline" onClick={() => { setProbeResult(undefined) }}>{t('close')}</Button>}
          >
            {probeResult.ok
              ? (
                <>
                  <p className={styles['probeOk']}>
                    {t('probeTools').replace('{count}', String(probeResult.tools.length))}
                  </p>
                  <ul className={styles['toolList']}>
                    {probeResult.tools.map(tool => (
                      <li key={tool.name} className={styles['toolRow']}>
                        <span className={styles['toolName']}>{tool.name}</span>
                        {tool.description !== undefined ? <span className={styles['toolDesc']}>{tool.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              )
              : <p className={styles['error']}>{`${t('probeFailed')}: ${probeResult.message}`}</p>}
          </Modal>
        )
        : null}
    </div>
  )
}

/** Narrow a stored settings value to a probe-able profile, or undefined. */
function probeProfileOf(name: string, value: unknown): McpProbeRequestView | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.transport === 'stdio') {
    return {
      serverName: name,
      transport: 'stdio',
      command: typeof raw.command === 'string' ? raw.command : '',
    }
  }
  if (raw.transport === 'streamable-http') {
    return {
      serverName: name,
      transport: 'streamable-http',
      url: typeof raw.url === 'string' ? raw.url : '',
    }
  }
  return undefined
}
