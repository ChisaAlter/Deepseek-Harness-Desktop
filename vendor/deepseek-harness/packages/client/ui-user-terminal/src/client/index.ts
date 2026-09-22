/** Browser plugin owning the bottom-drawer Terminal shell. */

export { apply, inject } from './apply.ts'
export type {
  TerminalDrawerProps, TerminalKey, TerminalShellInjected,
} from './apply.ts'
export { createTerminalSessionStore, MAX_TERMINALS_PER_GROUP } from './apply.ts'
