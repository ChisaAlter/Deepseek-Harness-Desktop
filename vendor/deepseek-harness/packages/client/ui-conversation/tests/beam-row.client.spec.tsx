// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { BeamRow } from '../src/client/settings/BeamRow.tsx'
import type { BeamRowProps } from '../src/client/settings/BeamRow.tsx'
import { en } from '../src/client/locales.ts'
import { DEFAULT_COMPOSER_BEAM_STYLE } from '../src/submission-settings.ts'

afterEach(cleanup)

const unused = (() => { throw new Error('unused by BeamRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setComposerBeam = vi.fn()
  const setComposerBeamStyle = vi.fn()
  const props: BeamRowProps = {
    useSessions: unused,
    useSessionPendingInteraction: unused,
    useWorkspaces: unused,
    useComposerBeam: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? true)),
    useComposerBeamStyle: bindSnapshotSelector(createSnapshotStore(DEFAULT_COMPOSER_BEAM_STYLE)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setComposerBeam,
    setComposerBeamStyle,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<BeamRow {...props} />)
  return { setComposerBeam, setComposerBeamStyle }
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

  it('opens a draft modal, previews edits, and saves or resets the complete style', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    expect(screen.getByRole('dialog', { name: 'Thinking glow' })).toBeTruthy()

    fireEvent.change(screen.getByRole('slider', { name: 'Rotation period' }), { target: { value: '3.25' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Overall intensity' }), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.setComposerBeamStyle).toHaveBeenCalledWith({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      period: 3.25,
      intensity: 120,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.setComposerBeamStyle).toHaveBeenLastCalledWith(DEFAULT_COMPOSER_BEAM_STYLE)
  })

  it('discards modal edits on cancel', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Hue offset' }), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mounted.setComposerBeamStyle).not.toHaveBeenCalled()
  })
})
