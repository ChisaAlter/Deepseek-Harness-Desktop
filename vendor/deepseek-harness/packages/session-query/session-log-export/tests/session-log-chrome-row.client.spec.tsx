// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionLogChromeRow } from '../src/client/SessionLogChromeRow.tsx'
import type { SessionLogChromeRowProps } from '../src/client/SessionLogChromeRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const unused = (() => { throw new Error('unused by SessionLogChromeRow') }) as never

function mount(opts: { visible?: boolean; writable?: boolean } = {}) {
  const setTitlebarAction = vi.fn()
  const props: SessionLogChromeRowProps = {
    useSessions: unused,
    useWorkspaces: unused,
    useTitlebarAction: bindSnapshotSelector(createSnapshotStore(opts.visible ?? true)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setTitlebarAction,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<SessionLogChromeRow {...props} />)
  return { setTitlebarAction }
}

describe('SessionLogChromeRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Session log export' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setTitlebarAction).toHaveBeenCalledWith(false)
    cleanup()
    mount({ writable: false })
    expect(screen.getByRole('switch', { name: 'Session log export' })).toHaveProperty('disabled', true)
  })
})
