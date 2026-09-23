// Stylesheet for the remote-workspace UI. Tags are claimed by the module
// loader's HMR bookkeeping through data-plugin, and data-plugin-css dedupes
// repeat installs.
const STYLE_ID = 'dsh-remote'

const CSS = `
.dshr-page { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshr-card { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshr-cardTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px; }
.dshr-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshr-rowBetween { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshr-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshr-grow { flex: 1; min-width: 0; }
.dshr-muted { color: var(--dsw-alias-label-tertiary); }
.dshr-secondary { color: var(--dsw-alias-label-secondary); }
.dshr-caption { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); font-size: 12px; }
.dshr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }
.dshr-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.dshr-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-mono { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-mono input { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-iconBtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.dshr-iconBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-iconBtn:disabled { opacity: 0.4; cursor: not-allowed; }

.dshr-machineList { display: flex; flex-direction: column; gap: 6px; }
.dshr-machine { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dshr-machine[data-current="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.dshr-machineMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dshr-machineName { font-weight: 600; font-size: 13px; }
.dshr-machineSub { font-size: 12px; color: var(--dsw-alias-label-tertiary); display: flex; gap: 8px; flex-wrap: wrap; }

.dshr-form { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.dshr-formLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: right; }
.dshr-formLabelLeft { text-align: left; }
.dshr-formFull { grid-column: 1 / -1; }
.dshr-checkRow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }

.dshr-flow { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }
.dshr-crumbNav { min-width: 0; overflow: hidden; }
.dshr-crumbs { display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; }
.dshr-crumbItem { display: flex; align-items: center; min-width: 0; flex: 0 1 auto; }
.dshr-crumbSeparator { display: inline-flex; align-items: center; flex: 0 0 auto; }
.dshr-crumb { appearance: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 1px 3px; border-radius: 4px; }
.dshr-crumb:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-crumb:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dshr-crumbLast { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 600; padding: 1px 3px; border-radius: 4px; }
.dshr-list { flex: 1; min-height: 140px; max-height: 280px; overflow-y: auto; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 4px; }
.dshr-listItem { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; cursor: pointer; }
.dshr-listItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-listItem:disabled { cursor: default; }
.dshr-listItem[data-kind="file"] { color: var(--dsw-alias-label-tertiary); }
.dshr-listEmpty { padding: 18px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.dshr-tree { height: 100%; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; }
.dshr-treeRow { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; text-align: left; cursor: pointer; }
.dshr-treeRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-treeRow[data-kind="file"] { color: var(--dsw-alias-label-secondary); }
.dshr-treeToggle { width: 14px; flex-shrink: 0; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dshr-treeName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-treeBadge { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); flex-shrink: 0; }

.dshr-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.dshr-editorHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); font-size: 12px; }
.dshr-editorBody { flex: 1; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.dshr-editorText { flex: 1; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.dshr-editorView { font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }

.dshr-audit { max-height: 220px; overflow-y: auto; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.dshr-emptyState { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshr-warn { color: var(--dsw-alias-state-warn-primary); }
`

export function installRemoteStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-remote'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => style.remove()
}
