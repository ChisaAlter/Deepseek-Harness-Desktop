import type { ReactNode } from 'react'

/** DOM lease marker for the native BrowserView presentation. */
export function BrowserSurfaceSlot({ children }: { children?: ReactNode }): ReactNode {
  return <div data-browser-surface-slot="dshd-mini-player" style={{ position: 'absolute', inset: 0 }}>{children}</div>
}
