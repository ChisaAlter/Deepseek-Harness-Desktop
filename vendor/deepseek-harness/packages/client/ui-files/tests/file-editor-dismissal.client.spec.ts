// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFileEditorDismissal } from '../src/client/fileEditorDismissal.ts'

function mountPreview(): {
  root: HTMLDivElement
  textarea: HTMLTextAreaElement
  outside: HTMLDivElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-file-preview', '')
  const textarea = document.createElement('textarea')
  textarea.value = 'one\ntwo\nthree'
  root.append(textarea)
  const outside = document.createElement('div')
  document.body.append(root, outside)
  return { root, textarea, outside }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('installFileEditorDismissal', () => {
  it('dismisses on pointerdown outside the preview root', () => {
    const { root, textarea, outside } = mountPreview()
    const blur = vi.spyOn(textarea, 'blur')
    const setSelectionRange = vi.spyOn(textarea, 'setSelectionRange')
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => false,
      onDismiss,
    })
    textarea.focus()
    textarea.setSelectionRange(0, 3)
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(blur).toHaveBeenCalled()
    expect(setSelectionRange).toHaveBeenCalledWith(0, 0)
    uninstall()
  })

  it('dismisses on Escape while the textarea is focused', () => {
    const { root, textarea } = mountPreview()
    const blur = vi.spyOn(textarea, 'blur')
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => false,
      onDismiss,
    })
    textarea.focus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stopped = vi.fn()
    document.addEventListener('keydown', stopped)
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(blur).toHaveBeenCalled()
    uninstall()
    document.removeEventListener('keydown', stopped)
  })

  it('does not dismiss on pointerdown inside the preview root', () => {
    const { root, textarea } = mountPreview()
    const blur = vi.spyOn(textarea, 'blur')
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => false,
      onDismiss,
    })
    textarea.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(blur).not.toHaveBeenCalled()
    uninstall()
  })

  it('skips pointerdown and Escape while isBlocked is true', () => {
    const { root, textarea, outside } = mountPreview()
    const blur = vi.spyOn(textarea, 'blur')
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => true,
      onDismiss,
    })
    textarea.focus()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(blur).not.toHaveBeenCalled()
    uninstall()
  })

  it('ignores Escape when focus is not the preview textarea', () => {
    const { root, textarea } = mountPreview()
    const other = document.createElement('textarea')
    document.body.append(other)
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => false,
      onDismiss,
    })
    other.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    uninstall()
  })

  it('still dismisses when setSelectionRange is absent', () => {
    const { root, outside } = mountPreview()
    const editor = { blur: vi.fn() }
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => false,
      onDismiss,
    })
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(editor.blur).toHaveBeenCalled()
    uninstall()
  })

  it('removes listeners on uninstall', () => {
    const { root, textarea, outside } = mountPreview()
    const onDismiss = vi.fn()
    const uninstall = installFileEditorDismissal({
      root,
      editor: textarea,
      isBlocked: () => false,
      onDismiss,
    })
    uninstall()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    textarea.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
