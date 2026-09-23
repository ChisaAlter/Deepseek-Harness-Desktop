import * as React from 'react'
import { Button, FileTypeIcon, Input, Modal, SettingsSelect, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { parentRemotePath, remoteApi, remoteCrumbs } from './api.js'

/**
 * The「远程」tab of the workspace picker. The owner (ui-directory-picker-browse)
 * keeps this mounted after the first visit and only flips `active`, so machine
 * selection, connection state, and the browse position survive tab switches.
 * Picking a directory asks the host for the local mirror and hands THAT path
 * to `onPicked` — the owner's workspace adoption stays remote-agnostic.
 */
export function RemoteFlowPane({ open, active, busy, onPicked, onCancel, onError, t }) {
  const [machines, setMachines] = React.useState(null)
  const [machineId, setMachineId] = React.useState('')
  const [connected, setConnected] = React.useState(false)
  const [path, setPath] = React.useState('')
  const [items, setItems] = React.useState(null) // null = not loaded
  const [platform, setPlatform] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [choosing, setChoosing] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [mkdirOpen, setMkdirOpen] = React.useState(false)
  const [mkdirName, setMkdirName] = React.useState('')
  const loadedOnce = React.useRef(false)

  const list = React.useCallback((dir) => {
    setLoading(true); setErr('')
    remoteApi.ls(dir)
      .then((res) => {
        setPlatform(res && res.platform === 'windows' ? 'windows' : 'posix')
        setPath(res && res.path !== undefined && res.path !== '' ? res.path : dir)
        const entries = Array.isArray(res && res.items) ? res.items : []
        entries.sort((a, b) => {
          const ad = (a.type === 'dir' || a.drive) ? 0 : 1
          const bd = (b.type === 'dir' || b.drive) ? 0 : 1
          return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name))
        })
        setItems(entries)
        setConnected(true)
      })
      .catch((e) => { setConnected(false); setItems(null); setErr(t('picker.listFail', { error: String((e && e.message) || e) })) })
      .finally(() => setLoading(false))
  }, [t])

  // First activation inside an open dialog: pull the machine registry and
  // enter the remembered (or first) machine's root view.
  React.useEffect(() => {
    if (!open || !active || loadedOnce.current) return
    loadedOnce.current = true
    remoteApi.machines()
      .then((r) => {
        const list0 = r.machines || []
        setMachines(list0)
        const initial = r.currentId || (list0[0] && list0[0].id) || ''
        setMachineId(initial)
        if (initial) {
          remoteApi.setCurrent(initial).catch(() => {})
            .then(() => list(''))
        }
      })
      .catch((e) => setErr(String((e && e.message) || e)))
  }, [open, active, list])

  const selectMachine = (id) => {
    if (!id || id === machineId && items !== null) return
    setMachineId(id)
    setItems(null); setPath(''); setErr('')
    remoteApi.setCurrent(id).catch(() => {})
      .then(() => list(''))
  }

  const enterDir = (it) => {
    if (busy || loading) return
    list(it.path)
  }

  const goUp = () => {
    if (loading) return
    const parent = parentRemotePath(path)
    list(parent || '')
  }

  const goHome = () => {
    if (loading) return
    setLoading(true); setErr('')
    remoteApi.remoteHome()
      .then((r) => {
        if (r && r.home) list(r.home)
        else { setErr((r && (r.hint || r.error)) || ''); setLoading(false) }
      })
      .catch((e) => { setErr(String((e && e.message) || e)); setLoading(false) })
  }

  const choose = () => {
    const target = String(path || '').trim()
    if (!target || busy || choosing) return
    setChoosing(true); setErr('')
    remoteApi.pickWorkspace(target)
      .then((res) => {
        if (res && res.localMirror) onPicked(res.localMirror)
        else { setErr((res && res.error) || ''); setChoosing(false) }
      })
      .catch((e) => {
        const text = String((e && e.message) || e)
        setErr(text)
        if (typeof onError === 'function') onError(text)
        setChoosing(false)
      })
  }

  const confirmMkdir = () => {
    const name = mkdirName.trim()
    if (!name) return
    const base = path || '/'
    const sep = base.includes('\\') ? '\\' : '/'
    const full = base === '/' ? '/' + name : base.replace(/[\\/]+$/, '') + sep + name
    setMkdirOpen(false); setMkdirName('')
    remoteApi.fs('mkdir', { path: full })
      .then(() => list(base))
      .catch((e) => setErr(String((e && e.message) || e)))
  }

  const crumbs = remoteCrumbs(path)
  const machineOptions = (machines || []).map((m) => ({ id: m.id, label: `${m.name || m.host} (${m.username}@${m.host}:${m.port})` }))
  const rootLabel = platform === 'windows' ? t('picker.rootPc') : '/'

  if (machines && machines.length === 0) {
    return (
      <div className="dshr-flow">
        <div className="dshr-emptyState">
          <span>{t('picker.machineEmpty')}</span>
          <span className="dshr-caption">{t('picker.machineEmptyHint')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="dshr-flow">
      <div className="dshr-row">
        <span className="dshr-formLabel" style={{ textAlign: 'left' }}>{t('picker.machine')}</span>
        <SettingsSelect
          variant="block" className="dshr-grow"
          value={machineId} options={machineOptions}
          onChange={selectMachine} disabled={busy || loading}
          aria-label={t('picker.machine')}
        />
        <StateDot state={connected ? 'done' : (loading ? 'ongoing' : 'idle')} />
      </div>

      <div className="dshr-row">
        <Input
          value={path} onChange={(e) => { setPath(e.target.value); setErr('') }}
          placeholder={t('picker.pathPlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); list(path) } }}
          className="dshr-grow dshr-mono"
          aria-label={t('picker.pathPlaceholder')}
        />
        <button type="button" className="dshr-iconBtn" title={t('picker.home')} aria-label={t('picker.home')} onClick={goHome} disabled={busy || loading}>~</button>
        <button type="button" className="dshr-iconBtn" title={t('picker.up')} aria-label={t('picker.up')} onClick={goUp} disabled={busy || loading || !path}>↑</button>
        <button type="button" className="dshr-iconBtn" title={t('picker.refresh')} aria-label={t('picker.refresh')} onClick={() => list(path)} disabled={busy || loading}>⟳</button>
      </div>

      {path ? (
        <div className="dshr-crumbs">
          <span className="dshr-crumb" onClick={() => list('')}>{rootLabel}</span>
          {crumbs.parts && crumbs.parts.map((c, i) => (
            <React.Fragment key={c.path}>
              <span>{crumbs.sep === '\\' ? '\\' : '›'}</span>
              <span className={'dshr-crumb' + (i === crumbs.parts.length - 1 ? ' dshr-crumbLast' : '')} onClick={() => list(c.path)}>{c.name}</span>
            </React.Fragment>
          ))}
        </div>
      ) : null}

      <div className="dshr-list">
        {loading && items === null ? <div className="dshr-listEmpty">{t('picker.loading')}</div> : null}
        {!loading && items === null && err ? <div className="dshr-listEmpty">{err}</div> : null}
        {items !== null && items.length === 0 ? <div className="dshr-listEmpty">{t('picker.noDirs')}</div> : null}
        {(items || []).map((it) => {
          const isDir = it.type === 'dir' || !!it.drive
          return (
            <button
              key={it.path || it.name} type="button" className="dshr-listItem"
              data-kind={isDir ? 'dir' : 'file'}
              onClick={() => { if (isDir) enterDir(it) }}
              disabled={!isDir}
              title={it.path || it.name}
            >
              {isDir ? <FileTypeIcon kind="folder" size={14} /> : <FileTypeIcon path={it.name} size={14} />}
              <span className="dshr-treeName">{it.name}</span>
            </button>
          )
        })}
      </div>

      {err && items !== null ? <div className="dshr-error">{err}</div> : null}
      <div className="dshr-caption">{t('picker.mirrorHint')}</div>

      <div className="dshr-rowBetween">
        <Button variant="ghost" size="sm" onClick={() => { setMkdirName(''); setMkdirOpen(true) }} disabled={busy || loading || !path}>
          {t('picker.mkdir')}
        </Button>
        <Button variant="primary" size="sm" onClick={choose} disabled={busy || loading || choosing || !path}>
          {choosing ? t('picker.choosing') : t('picker.choose')}
        </Button>
      </div>

      <Modal
        open={mkdirOpen} onClose={() => setMkdirOpen(false)}
        title={t('picker.mkdir')} closeLabel={t('common.close')}
        footer={(
          <React.Fragment>
            <Button variant="ghost" size="sm" onClick={() => setMkdirOpen(false)}>{t('form.cancel')}</Button>
            <Button variant="primary" size="sm" onClick={confirmMkdir} disabled={!mkdirName.trim()}>{t('picker.mkdir')}</Button>
          </React.Fragment>
        )}
      >
        <Input
          value={mkdirName} onChange={(e) => setMkdirName(e.target.value)}
          placeholder={t('picker.mkdirName')} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmMkdir() } }}
        />
      </Modal>
    </div>
  )
}
