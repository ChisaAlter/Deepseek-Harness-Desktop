/** Shared modal keyboard ownership and focus lifetime. */
import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { observeComposition } from './keyboard-composition.ts'
import { focusWithoutRing } from './focus.ts'

/** Dialog and menu elements whose document order determines foreground shortcut ownership. */
export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'

/**
 * Markers that mean "this surface is no longer logically open" even though the
 * exit recipe keeps its DOM mounted. Surfaces hidden by an ancestor count too:
 * a closing Modal keeps `aria-hidden` on its overlay root, not on the panel.
 */
const inactiveSelector = '[aria-hidden="true"], [inert], [hidden]'

/**
 * Foreground candidates in document order. A retained exit frame must not keep
 * owning keyboard input: a menu closed inside a dialog would otherwise stay the
 * last `modalSelector` match and block the dialog's own close command.
 *
 * Filtering on `data-state` would be wrong — an entering surface is logically
 * open while its first frames still read `closed` — so logical activity is read
 * from the accessibility/inert markers the surfaces already publish.
 * @param document - product document to measure.
 * @returns the surfaces that can own foreground input right now.
 */
export function foregroundModalSurfaces(document: Document): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(modalSelector)]
    .filter(element => element.closest(inactiveSelector) === null)
}

interface ModalLayer {
  element: HTMLElement
  close: () => void
  /**
   * Return target captured by a layer that retired while another layer was
   * still in front of it. Without this, closing a parent and its child in one
   * commit would drop the parent's own opener: the parent never restores
   * (it was not top) and the child's opener lives inside the now-inactive
   * parent, leaving no candidate at all.
   */
  outerOpener?: HTMLElement | undefined
}

const layers = new WeakMap<Document, ModalLayer[]>()

/**
 * Request closure of the foreground registered modal using its current onClose callback.
 * A newer menu or unregistered dialog blocks dismissal of the modal behind it.
 * @param document - product document whose modal owns the close command.
 */
export function closeTopModal(document: Document): void {
  const top = layers.get(document)?.at(-1)
  if (top === undefined) return
  const foreground = foregroundModalSurfaces(document).at(-1)
  if (foreground === top.element) top.close()
}
/**
 * Whether an anchor belongs behind the current modal and must yield keyboard input.
 * @param anchor - local control owning the input handler.
 * @returns true when another modal owns the foreground.
 */
export function isBehindModal(anchor: HTMLElement | null): boolean {
  if (anchor === null) return false
  const top = layers.get(anchor.ownerDocument)?.at(-1)
  return top !== undefined && !top.element.contains(anchor)
}

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'

/**
 * Give only the top modal Escape and Tab ownership, then restore its previous focus.
 * Automatic entry and return focus omit outlines; keyboard traversal retains its indicators.
 * Controls mounted with the dialog use data-modal-autofocus for initial focus;
 * React autoFocus runs before this layer can capture the invoking control.
 * Local menus handle their Escape during capture before this bubble listener.
 * @param dialog - mounted dialog element.
 * @param open - whether this layer is active.
 * @param onClose - top-layer Escape or application close action.
 */
export function useModalLayer(dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose)
  close.current = onClose
  /** Return-focus work deferred to the closing commit's layout-effect setup. */
  const pendingRestore = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) {
      // Closing commit. React destroys layout effects during its mutation phase
      // and then restores its own notion of selection in `resetAfterCommit`,
      // which would undo a focus call made from this effect's cleanup — the
      // exit recipe keeps the closing control connected, so React can still
      // see it. This setup runs after `resetAfterCommit`, which makes it the
      // earliest point where return focus actually survives the commit.
      const restore = pendingRestore.current
      pendingRestore.current = null
      restore?.()
      return
    }
    pendingRestore.current = null
    const document = element.ownerDocument
    const composition = observeComposition(document)
    const previous = document.activeElement
    const stack = layers.get(document) ?? []
    layers.set(document, stack)
    const layer = { element, close: () => { close.current() } }
    stack.push(layer)
    /**
     * A surface that is only being retained for its exit recipe is not a
     * foreground owner. Read the published inactivity markers instead of
     * `data-state`, because an entering surface is logically open while its
     * first frames still report `closed`.
     */
    const inactive = (): boolean => element.closest(inactiveSelector) !== null
    const initial = element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? element.querySelector<HTMLElement>(focusable) ?? element
    if (!element.contains(document.activeElement)) focusWithoutRing(initial)
    const keydown = (event: KeyboardEvent): void => {
      const composing = composition.guards(event)
      if (stack.at(-1) !== layer || inactive() || event.defaultPrevented || composing
        || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
      }
      if (event.key !== 'Tab') return
      // Portaled menus own their traversal while they contain focus, but a
      // menu retained for its exit recipe must not suppress this dialog's
      // traversal: an owner can close a focused menu without the menu's own
      // Escape handoff, leaving focus inside the retiring subtree.
      const focusedMenu = document.activeElement?.closest<HTMLElement>('[role="menu"]')
      if (focusedMenu != null && focusedMenu.closest(inactiveSelector) === null) return
      const items = [...element.querySelectorAll<HTMLElement>(focusable)]
        .filter(item => !item.closest(`${inactiveSelector}, [hidden]`))
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      /**
       * Focus inside a retired subtree (a menu retained for its exit recipe)
       * needs explicit recovery: it is still a DOM descendant of this dialog,
       * so it is neither "outside" nor at an eligible edge, and staying there
       * would leave the keyboard in DOM the user can no longer see.
       */
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest(inactiveSelector) !== null && element.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      if (document.activeElement === element || !element.contains(document.activeElement) || atEdge) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      composition.dispose()
      const wasTop = stack.at(-1) === layer
      stack.splice(stack.indexOf(layer), 1)
      document.removeEventListener('keydown', keydown)
      if (stack.length === 0) layers.delete(document)
      if (wasTop) {
        const fallback = stack.at(-1)?.element
        const restore = (): void => {
          // Resolve ownership against the document when this actually runs. A
          // newer layer may have registered after `wasTop` was decided — in the
          // same commit, or after the stack array was replaced — and that layer
          // owns the keyboard now. The captured `stack` array cannot answer
          // this: cleanup deletes the WeakMap entry once that array drains, so
          // a later layer registers into a different array.
          const currentStack = layers.get(document)
          const current = currentStack?.at(-1)
          if (current !== undefined && current.element !== fallback) return
          /**
           * Eligibility is tested BEFORE choosing. `isConnected` alone is not
           * enough: an opener inside another closing modal stays connected
           * while that modal is retained for its exit. Choosing the opener
           * first and rejecting it afterwards would strand focus in the
           * retiring subtree even though the surviving parent is a valid
           * destination — e.g. closing a child whose opener lives in a hidden
           * parent, or closing parent and child in the same commit.
           */
          const eligible = (target: HTMLElement | undefined): target is HTMLElement =>
            target !== undefined && target.isConnected && target.closest(inactiveSelector) === null
          const opener = previous instanceof HTMLElement ? previous : undefined
          const candidate = eligible(opener) ? opener : eligible(fallback) ? fallback : undefined
          if (candidate !== undefined) focusWithoutRing(candidate)
        }
        // Keep the deferred retry for the commit path, and also apply it now so
        // a full unmount (where no later layout setup runs) still returns focus.
        pendingRestore.current = restore
        restore()
      }
    }
  }, [dialog, open])
}
