import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14,
  IconCodeOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { createFileTreeDragMentionController, type FileTreeDragMentionController } from './fileTreeDragMention.ts'
import { filterEntries } from './filter.ts'
import type { DirEntry } from './shell.ts'
import css from './FileTree.module.css'

/** A workspace entry with its path relative to session cwd. */
export interface TreeEntry extends DirEntry {
  path: string
}

export interface FileTreeProps {
  entries: readonly TreeEntry[]
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onMention?: ((path: string) => void) | undefined
  onCopyRelative?: ((path: string) => void) | undefined
  onCopyAbsolute?: ((path: string) => void) | undefined
  onCopyMention?: ((path: string) => void) | undefined
  mentionLabel?: string | undefined
  copyRelativeLabel?: string | undefined
  copyAbsoluteLabel?: string | undefined
  copyMentionLabel?: string | undefined
  onShowInFolder?: ((path: string) => void) | undefined
  onOpenInEditor?: ((editor: string, path: string) => void) | undefined
  onOpenWithSystemDefault?: ((path: string) => void) | undefined
  editors?: readonly { id: string, label: string }[] | undefined
  showInFolderLabel?: string | undefined
  openWithSystemDefaultLabel?: string | undefined
  /** Case-insensitive name filter; empty shows every row. */
  query?: string | undefined
  /** False for nested directory lists so they keep indent. */
  root?: boolean | undefined
  /** Shared by nested lists so a drag started on a child row stays in progress. */
  dragMention?: FileTreeDragMentionController | undefined
}

/**
 * Join a parent relative path and a child name with `/`.
 * @param parent - parent relative path, or empty for the workspace root.
 * @param name - entry name.
 * @returns the child relative path.
 */
export function joinRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/**
 * Read-only workspace tree. Directories expand in place; files call onOpenFile.
 * @param props - entries, expanded dirs, and callbacks.
 * @returns the tree.
 */
export function FileTree({
  entries,
  childrenByPath,
  expanded,
  onToggle,
  onOpenFile,
  onMention,
  onCopyRelative,
  onCopyAbsolute,
  onCopyMention,
  mentionLabel,
  copyRelativeLabel,
  copyAbsoluteLabel,
  copyMentionLabel,
  onShowInFolder,
  onOpenInEditor,
  onOpenWithSystemDefault,
  editors = [],
  showInFolderLabel,
  openWithSystemDefaultLabel,
  query = '',
  root = true,
  dragMention: inherited,
}: FileTreeProps): ReactNode {
  const owned = useRef<FileTreeDragMentionController | undefined>(undefined)
  if (inherited === undefined && owned.current === undefined) {
    owned.current = createFileTreeDragMentionController({ deselect: () => {} })
  }
  const dragMention = inherited ?? owned.current!
  const visible = filterEntries(entries, query, childrenByPath)
  return (
    <ul className={css.list} {...(root ? { 'data-file-tree': true } : {})}>
      {visible.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          childrenByPath={childrenByPath}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onMention={onMention}
          onCopyRelative={onCopyRelative}
          onCopyAbsolute={onCopyAbsolute}
          onCopyMention={onCopyMention}
          mentionLabel={mentionLabel}
          copyRelativeLabel={copyRelativeLabel}
          copyAbsoluteLabel={copyAbsoluteLabel}
          copyMentionLabel={copyMentionLabel}
          onShowInFolder={onShowInFolder}
          onOpenInEditor={onOpenInEditor}
          onOpenWithSystemDefault={onOpenWithSystemDefault}
          editors={editors}
          showInFolderLabel={showInFolderLabel}
          openWithSystemDefaultLabel={openWithSystemDefaultLabel}
          query={query}
          dragMention={dragMention}
        />
      ))}
    </ul>
  )
}

function TreeNode({
  entry,
  childrenByPath,
  expanded,
  onToggle,
  onOpenFile,
  onMention,
  onCopyRelative,
  onCopyAbsolute,
  onCopyMention,
  mentionLabel,
  copyRelativeLabel,
  copyAbsoluteLabel,
  copyMentionLabel,
  onShowInFolder,
  onOpenInEditor,
  onOpenWithSystemDefault,
  editors,
  showInFolderLabel,
  openWithSystemDefaultLabel,
  query,
  dragMention,
}: {
  entry: TreeEntry
  childrenByPath: FileTreeProps['childrenByPath']
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onMention: FileTreeProps['onMention']
  onCopyRelative: FileTreeProps['onCopyRelative']
  onCopyAbsolute: FileTreeProps['onCopyAbsolute']
  onCopyMention: FileTreeProps['onCopyMention']
  mentionLabel: FileTreeProps['mentionLabel']
  copyRelativeLabel: FileTreeProps['copyRelativeLabel']
  copyAbsoluteLabel: FileTreeProps['copyAbsoluteLabel']
  copyMentionLabel: FileTreeProps['copyMentionLabel']
  onShowInFolder: FileTreeProps['onShowInFolder']
  onOpenInEditor: FileTreeProps['onOpenInEditor']
  onOpenWithSystemDefault: FileTreeProps['onOpenWithSystemDefault']
  editors: readonly { id: string, label: string }[]
  showInFolderLabel: FileTreeProps['showInFolderLabel']
  openWithSystemDefaultLabel: FileTreeProps['openWithSystemDefaultLabel']
  query: string
  dragMention: FileTreeDragMentionController
}): ReactNode {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const items: MenuEntry[] = []
  if (onCopyMention !== undefined && copyMentionLabel !== undefined) {
    items.push({ id: 'copy.mention', label: copyMentionLabel })
  }
  if (onCopyRelative !== undefined && copyRelativeLabel !== undefined) {
    items.push({ id: 'relative', label: copyRelativeLabel })
  }
  if (onCopyAbsolute !== undefined && copyAbsoluteLabel !== undefined) {
    items.push({ id: 'absolute', label: copyAbsoluteLabel })
  }
  if (onShowInFolder !== undefined && showInFolderLabel !== undefined) {
    items.push({ id: 'open.folder', label: showInFolderLabel })
  }
  if (entry.kind === 'file') {
    for (const editor of editors) {
      items.push({ id: `editor.${editor.id}`, label: editor.label })
    }
    if (onOpenWithSystemDefault !== undefined && openWithSystemDefaultLabel !== undefined) {
      items.push({ id: 'open.system', label: openWithSystemDefaultLabel })
    }
  }

  const onContext = (event: MouseEvent) => {
    if (items.length === 0) return
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const row = (
    <button
      type="button"
      className={css.row}
      draggable={entry.kind === 'file'}
      data-item-path={entry.path}
      aria-expanded={entry.kind === 'directory' ? expanded.has(entry.path) : undefined}
      onClick={() => {
        if (entry.kind === 'file') {
          if (dragMention.isDragInProgress()) return
          onOpenFile(entry.path)
          return
        }
        onToggle(entry.path)
      }}
      onContextMenu={onContext}
      onDragStart={(event) => {
        dragMention.handleDragStart({
          dataTransfer: event.dataTransfer,
          composedPath: () => event.nativeEvent.composedPath(),
        })
      }}
      onDragEnd={() => {
        dragMention.handleDragEnd()
      }}
    >
      {entry.kind === 'directory' ? (
        <IconChevronRightOutline14
          size={12}
          className={clsx(css.twist, expanded.has(entry.path) && css.twistOpen)}
        />
      ) : (
        <span className={css.twist} aria-hidden="true" />
      )}
      {entry.kind === 'directory'
        ? (expanded.has(entry.path)
          ? <IconFolderOpen16 size={14} className={css.icon} />
          : <IconFolderClose16 size={14} className={css.icon} />)
        : <IconCodeOutline16 size={14} className={css.icon} />}
      <span className={css.name}>{entry.name}</span>
    </button>
  )

  const mention = entry.kind === 'file' && onMention !== undefined && mentionLabel !== undefined ? (
    <button
      type="button"
      className={css.mention}
      aria-label={mentionLabel}
      onClick={(event) => {
        event.stopPropagation()
        onMention(entry.path)
      }}
    >
      @
    </button>
  ) : null

  const menuNode = menu !== null && items.length > 0 ? (
    <Menu
      open
      portal
      compact
      getAnchorRect={() => new DOMRect(menu.x, menu.y, 0, 0)}
      items={items}
      onSelect={(id) => {
        setMenu(null)
        if (id === 'copy.mention') {
          onCopyMention?.(entry.path)
          return
        }
        if (id === 'relative') {
          onCopyRelative?.(entry.path)
          return
        }
        if (id === 'open.folder') {
          onShowInFolder?.(entry.path)
          return
        }
        if (id === 'open.system') {
          onOpenWithSystemDefault?.(entry.path)
          return
        }
        if (id.startsWith('editor.')) {
          onOpenInEditor?.(id.slice('editor.'.length), entry.path)
          return
        }
        /* v8 ignore next -- Menu only emits the declared item ids. */
        if (id !== 'absolute') return
        onCopyAbsolute?.(entry.path)
      }}
      onClose={() => { setMenu(null) }}
      anchor={<span className={css.contextAnchor} />}
    />
  ) : null

  if (entry.kind === 'file') {
    return (
      <li className={css.item}>
        {row}
        {mention}
        {menuNode}
      </li>
    )
  }
  const open = expanded.has(entry.path)
  const children = childrenByPath[entry.path] ?? []
  return (
    <li className={css.item}>
      {row}
      {menuNode}
      {open ? (
        <FileTree
          entries={children}
          childrenByPath={childrenByPath}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onMention={onMention}
          onCopyRelative={onCopyRelative}
          onCopyAbsolute={onCopyAbsolute}
          onCopyMention={onCopyMention}
          mentionLabel={mentionLabel}
          copyRelativeLabel={copyRelativeLabel}
          copyAbsoluteLabel={copyAbsoluteLabel}
          copyMentionLabel={copyMentionLabel}
          onShowInFolder={onShowInFolder}
          onOpenInEditor={onOpenInEditor}
          onOpenWithSystemDefault={onOpenWithSystemDefault}
          editors={editors}
          showInFolderLabel={showInFolderLabel}
          openWithSystemDefaultLabel={openWithSystemDefaultLabel}
          query={query}
          root={false}
          dragMention={dragMention}
        />
      ) : null}
    </li>
  )
}
