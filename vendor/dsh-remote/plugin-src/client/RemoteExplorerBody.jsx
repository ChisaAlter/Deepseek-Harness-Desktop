import * as React from 'react'
import { Button, FileTypeIcon, Input, Menu, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { parentRemotePath, remoteApi, remoteFileAddress } from './api.js'

/**
 * Remote file tree bound to THIS session's mirror: the root resolves through
 * /dsh-remote/resolve-mirror from the session cwd, so a local session shows
 * the explicit empty state instead of some unrelated active machine (the
 * host's session binding enforces the same on every ls/fs call).
 */
export function RemoteExplorerBody({ useTabInfo, sessionId, useSessions, t }) {
  const info = useTabInfo()
  const cwd = useSessions((s) => (s.byId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
  const [root, setRoot] = React.useState(null) // null = resolving, '' = local session
  const [mirrorDir, setMirrorDir] = React.useState('')
  const [expanded, setExpanded] = React.useState(() => new Set())
  const [data, setData] = React.useState({}) // dir -> { loading?, entries?, error? }
  const [err, setErr] = React.useState('')
  const [menu, setMenu] = React.useState(null) // { x, y, item }
  const [namePrompt, setNamePrompt] = React.useState(null) // { kind, path, name }
  const [nameDraft, setNameDraft] = React.useState('')
  const [confirmDel, setConfirmDel] = React.useState(null) // { path, dir }
  const [copied, setCopied] = React.useState('')
  const dataRef = React.useRef(data)
  dataRef.current = data
  const visible = info.tab.visible

  const storeLevel = React.useCallback((dir, level) => {
    setData((prev) => ({ ...prev, [dir]: level }))
  }, [])

  const loadDir = React.useCallback((dir) => {
    const existing = dataRef.current[dir]
    if (existing && existing.loading) return
    storeLevel(dir, { ...existing, loading: true })
    remoteApi.ls(dir, sessionId)
      .then((res) => {
        const items = Array.isArray(res && res.items) ? res.items.slice() : []
        items.sort((a, b) => {
          const ad = a.type === 'dir' ? 0 : 1
          const bd = b.type === 'dir' ? 0 : 1
          return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name))
        })
        storeLevel(dir, { entries: items, missing: !!(res && res.missing) })
      })
      .catch((e) => {
        const prev = dataRef.current[dir]
        storeLevel(dir, prev && prev.entries
          ? { ...prev, softError: String((e && e.message) || e) }
          : { error: String((e && e.message) || e) })
      })
  }, [sessionId, storeLevel])

  // Resolve the session's remote root once per cwd change; a local session
  // resolves to '' and the tree stays empty on purpose.
  React.useEffect(() => {
    let cancelled = false
    setRoot(null); setData({}); setExpanded(new Set()); setErr('')
    remoteApi.resolveMirror(cwd, sessionId)
      .then((r) => {
        if (cancelled) return
        const remotePath = (r && r.remotePath) || ''
        setRoot(remotePath)
        setMirrorDir((r && r.mirrorDir) || '')
        if (remotePath) { setExpanded(new Set([remotePath])); loadDir(remotePath) }
      })
      .catch((e) => { if (!cancelled) setErr(String((e && e.message) || e)) })
    return () => { cancelled = true }
  }, [cwd, sessionId, loadDir])

  // Refresh on becoming visible again (connection may have recovered).
  React.useEffect(() => {
    if (visible && root) loadDir(root)
  }, [visible, root, loadDir])

  const toggleDir = (dir) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else { next.add(dir); loadDir(dir) }
      return next
    })
  }

  const openFile = (p) => {
    info.tab.actions.openResource(remoteFileAddress(sessionId, p))
  }

  const doFs = (op, payload) => {
    setErr('')
    return remoteApi.fs(op, payload, sessionId)
      .then(() => { if (root) loadDir(parentRemotePath(payload.path || root) || root); })
      .catch((e) => setErr(String((e && e.message) || e)))
  }

  const copyPath = (text, key) => {
    try {
      navigator.clipboard && navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1200)
    } catch { /* clipboard unavailable */ }
  }

  const relPath = (p) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, '') : p)

  const confirmName = () => {
    const name = nameDraft.trim()
    if (!name || !namePrompt) return
    const { kind, path: target } = namePrompt
    setNamePrompt(null)
    if (kind === 'rename') {
      const parent = parentRemotePath(target) || root || '/'
      const sep = parent.includes('\\') ? '\\' : '/'
      const dest = parent === '/' ? '/' + name : parent.replace(/[\\/]+$/, '') + sep + name
      doFs('rename', { path: target, dest })
    } else if (kind === 'mkdir') {
      const sep = target.includes('\\') ? '\\' : '/'
      const full = target === '/' ? '/' + name : target.replace(/[\\/]+$/, '') + sep + name
      doFs('mkdir', { path: full })
    }
  }

  const menuItems = menu ? [
    { id: 'open', label: menu.item.type === 'dir' ? t('explorer.menuExpand') : t('explorer.menuOpen') },
    { id: 'download', label: t('explorer.menuDownload') },
    { id: 'copy-rel', label: t('explorer.menuCopyRel') },
    { id: 'copy-abs', label: t('explorer.menuCopyAbs') },
    { type: 'separator', id: 'sep' },
    { id: 'rename', label: t('explorer.menuRename') },
    { id: 'mkdir', label: t('explorer.menuMkdir') },
    { type: 'separator', id: 'sep2' },
    { id: 'delete', label: menu.item.type === 'dir' ? t('explorer.menuDeleteDir') : t('explorer.menuDelete'), danger: true },
  ] : []

  const onMenuSelect = (id) => {
    const it = menu && menu.item
    if (!it) return
    setMenu(null)
    if (id === 'open') { if (it.type === 'dir') toggleDir(it.path); else openFile(it.path) }
    else if (id === 'download') void doFs('download', { path: it.path })
    else if (id === 'copy-rel') copyPath(relPath(it.path), it.path)
    else if (id === 'copy-abs') copyPath(it.path, it.path)
    else if (id === 'rename') { setNamePrompt({ kind: 'rename', path: it.path, name: it.name }); setNameDraft(it.name) }
    else if (id === 'mkdir') {
      const base = it.type === 'dir' ? it.path : (parentRemotePath(it.path) || root || '/')
      setNamePrompt({ kind: 'mkdir', path: base, name: '' }); setNameDraft('')
    } else if (id === 'delete') {
      setConfirmDel({ path: it.path, dir: it.type === 'dir' })
    }
  }

  const renderRows = (dir, depth) => {
    const level = data[dir]
    if (!level || !expanded.has(dir)) return null
    if (level.loading && !level.entries) {
      return <div key={dir + ':loading'} className="dshr-listEmpty" style={{ paddingLeft: 8 + depth * 14 }}>{t('explorer.loading')}</div>
    }
    if (level.error) {
      return (
        <div key={dir + ':err'} className="dshr-error" style={{ padding: '4px 8px', paddingLeft: 8 + depth * 14 }}>
          {level.error} <Button variant="ghost" size="sm" onClick={() => loadDir(dir)}>{t('explorer.retry')}</Button>
        </div>
      )
    }
    return (level.entries || []).map((it) => (
      <React.Fragment key={it.path}>
        <button
          type="button" className="dshr-treeRow" data-kind={it.type === 'dir' ? 'dir' : 'file'}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={it.path}
          onClick={() => { if (it.type === 'dir') toggleDir(it.path); else openFile(it.path) }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) }}
        >
          <span className="dshr-treeToggle">{it.type === 'dir' ? (expanded.has(it.path) ? '▾' : '▸') : ''}</span>
          {it.type === 'dir' ? <FileTypeIcon kind="folder" size={14} /> : <FileTypeIcon path={it.name} size={14} />}
          <span className="dshr-treeName">{it.name}</span>
          {copied === it.path ? <span className="dshr-treeBadge">{t('explorer.copied')}</span> : null}
        </button>
        {it.type === 'dir' ? renderRows(it.path, depth + 1) : null}
      </React.Fragment>
    ))
  }

  if (root === null) {
    return <div className="dshr-listEmpty">{t('explorer.loading')}</div>
  }
  if (root === '') {
    return (
      <div className="dshr-emptyState">
        <span>{t('explorer.empty')}</span>
        <span className="dshr-caption">{t('explorer.emptyHint')}</span>
      </div>
    )
  }

  const rootLevel = data[root]
  return (
    <div className="dshr-tree">
      <div className="dshr-row" style={{ padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)', marginBottom: 4 }}>
        <StateDot state={rootLevel && rootLevel.entries ? 'done' : 'ongoing'} size={8} />
        <span className="dshr-mono dshr-ellipsis dshr-secondary" style={{ fontSize: 12 }} title={mirrorDir ? `${root}\n${mirrorDir}` : root}>{root}</span>
        <button type="button" className="dshr-iconBtn" title={t('picker.refresh')} aria-label={t('picker.refresh')} onClick={() => { setData({}); loadDir(root) }}>⟳</button>
      </div>
      {err ? <div className="dshr-error" style={{ padding: '4px 6px' }}>{err}</div> : null}
      {rootLevel && rootLevel.missing ? <div className="dshr-caption" style={{ padding: '4px 6px' }}>{t('explorer.missing')}</div> : null}
      <button
        type="button" className="dshr-treeRow" style={{ paddingLeft: 8 }}
        onClick={() => toggleDir(root)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: { type: 'dir', path: root, name: root } }) }}
      >
        <span className="dshr-treeToggle">{expanded.has(root) ? '▾' : '▸'}</span>
        <FileTypeIcon kind="folder" size={14} />
        <span className="dshr-treeName" style={{ fontWeight: 600 }}>{t('explorer.root')}</span>
      </button>
      {expanded.has(root) ? renderRows(root, 1) : null}
      {rootLevel && rootLevel.entries && rootLevel.entries.length === 0 ? (
        <div className="dshr-listEmpty">{t('picker.empty')}</div>
      ) : null}

      {menu ? (
        <Menu
          open anchor={null} items={menuItems} onClose={() => setMenu(null)} onSelect={onMenuSelect}
          getAnchorRect={() => new DOMRect(menu.x, menu.y, 0, 0)}
          portal
        />
      ) : null}

      <Modal
        open={!!namePrompt} onClose={() => setNamePrompt(null)}
        title={namePrompt && namePrompt.kind === 'rename' ? t('explorer.menuRename') : t('explorer.menuMkdir')}
        closeLabel={t('common.close')}
        footer={(
          <React.Fragment>
            <Button variant="ghost" size="sm" onClick={() => setNamePrompt(null)}>{t('form.cancel')}</Button>
            <Button variant="primary" size="sm" onClick={confirmName} disabled={!nameDraft.trim()}>{t('form.save')}</Button>
          </React.Fragment>
        )}
      >
        <Input
          value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
          placeholder={t('explorer.newName')} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmName() } }}
        />
      </Modal>
    </div>
  )
}
