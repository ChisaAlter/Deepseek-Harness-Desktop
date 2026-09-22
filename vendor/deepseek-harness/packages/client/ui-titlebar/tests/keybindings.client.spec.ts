// @vitest-environment jsdom
/**
 * Titlebar shortcut helpers: skip editable targets and match panel chords.
 */
import { describe, expect, it } from 'vitest'
import {
  isEditableKeyboardTarget, isSurfacesShortcut, isTerminalShortcut, isTextEntryTarget,
} from '../src/client/keybindings.ts'

/** Ghostty pane host with its hidden input textarea, as production renders it. */
function terminalPaneFixture(): { pane: HTMLDivElement; input: HTMLTextAreaElement } {
  const pane = document.createElement('div')
  pane.setAttribute('data-terminal-pane', 'pty-1')
  const input = document.createElement('textarea')
  pane.append(input)
  return { pane, input }
}

describe('titlebar keybindings', () => {
  it('treats input, textarea, select, contenteditable, and terminal panes as editable', () => {
    expect(isEditableKeyboardTarget(null)).toBe(false)
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.setAttribute('contenteditable', 'true')
    const { pane, input: paneInput } = terminalPaneFixture()
    expect(isEditableKeyboardTarget(input)).toBe(true)
    expect(isEditableKeyboardTarget(textarea)).toBe(true)
    expect(isEditableKeyboardTarget(select)).toBe(true)
    expect(isEditableKeyboardTarget(editable)).toBe(true)
    expect(isEditableKeyboardTarget(pane)).toBe(true)
    expect(isEditableKeyboardTarget(paneInput)).toBe(true)
    expect(isEditableKeyboardTarget(document.createElement('div'))).toBe(false)
  })

  it('does not count the terminal pane textarea as plain text entry', () => {
    const { pane, input } = terminalPaneFixture()
    expect(isTextEntryTarget(input)).toBe(false)
    expect(isTextEntryTarget(pane)).toBe(false)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryTarget(null)).toBe(false)
  })

  it('matches surfaces and terminal chords with ctrl or meta', () => {
    expect(isSurfacesShortcut(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }))).toBe(true)
    expect(isSurfacesShortcut(new KeyboardEvent('keydown', { code: 'Backslash', metaKey: true }))).toBe(true)
    expect(isSurfacesShortcut(new KeyboardEvent('keydown', { key: '\\' }))).toBe(false)
    expect(isTerminalShortcut(new KeyboardEvent('keydown', { key: '`', ctrlKey: true }))).toBe(true)
    expect(isTerminalShortcut(new KeyboardEvent('keydown', { code: 'Backquote', metaKey: true }))).toBe(true)
    expect(isTerminalShortcut(new KeyboardEvent('keydown', { key: '`', shiftKey: true }))).toBe(false)
  })
})
