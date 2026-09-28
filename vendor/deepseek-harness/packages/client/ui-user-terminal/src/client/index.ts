/** Browser plugin owning the bottom-drawer and right-panel Terminal shells. */

export { apply, inject } from './apply.ts'
export type {
  TerminalDrawerProps, TerminalKey, TerminalShellInjected, TerminalSurfaceProps,
} from './apply.ts'
export { createTerminalSessionStore, MAX_TERMINALS_PER_GROUP } from './apply.ts'
