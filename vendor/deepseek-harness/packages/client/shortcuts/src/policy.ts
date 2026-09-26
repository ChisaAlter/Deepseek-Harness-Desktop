/** Explicit desktop input-arbitration policy shared by the DOM dispatcher, native adapter, and shell. */

/**
 * How a Desktop deployment arbitrates bound keys against local controls.
 * `native-priority` keeps the official behaviour: desktop bindings on
 * Windows/macOS override local regions. `local-first` resolves every physical
 * key through the same synchronous region/modal checks before consumption and
 * never lets a user binding override the protected local chords below.
 */
export type ShortcutInputPolicy = 'native-priority' | 'local-first'

/**
 * Deployment-selected policy mark on the product document. The trusted shell
 * preload sets `data-shortcut-policy="local-first"`; absence keeps
 * `native-priority`, so upstream Desktop behaviour is unchanged.
 */
export const SHORTCUT_POLICY_ATTRIBUTE = 'shortcutPolicy'

// Structural facts only: the protocol layer is shared by Host and Client
// compiler faces and cannot reach client/types.ts.
interface PolicyGesture {
  readonly code: string
  readonly secondCode?: string
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

interface PolicyContext {
  readonly region: string
}

/**
 * Chords whose local semantics a bound command may not steal, under the
 * local-first policy: copy/close stay with editable and terminal controls even
 * when the user bound the same key to an application command.
 * @param gesture - physical-key facts at dispatch.
 * @param context - synchronous input and modal owner.
 * @returns whether the event must pass through to the local control.
 */
export function localFirstProtected(gesture: PolicyGesture, context: PolicyContext): boolean {
  if (context.region !== 'editable' && context.region !== 'terminal') return false
  const plain = gesture.control && !gesture.meta && !gesture.alt && !gesture.shift
    && gesture.secondCode === undefined
  return plain && (gesture.code === 'KeyC' || gesture.code === 'KeyW')
}
