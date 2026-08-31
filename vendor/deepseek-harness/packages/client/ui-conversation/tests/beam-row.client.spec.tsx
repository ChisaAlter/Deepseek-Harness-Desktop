// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { BeamRow } from '../src/client/settings/BeamRow.tsx'
import type { BeamRowProps } from '../src/client/settings/BeamRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const unused = (() => { throw new Error('unused by BeamRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setComposerBeam = vi.fn()
  const props: BeamRowProps = {
    useSessions: unused,
    useSessionPendingInteraction: unused,
    useWorkspaces: unused,
    useComposerBeam: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? true)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setComposerBeam,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<BeamRow {...props} />)
  return { setComposerBeam }
}

describe('BeamRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Thinking glow when sending' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setComposerBeam).toHaveBeenCalledWith(false)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Thinking glow when sending' })).toHaveProperty('disabled', true)
  })
})
