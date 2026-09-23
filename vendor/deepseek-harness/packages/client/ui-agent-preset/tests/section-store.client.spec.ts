import { describe, expect, it, vi } from 'vitest'
import { AgentPresetSectionController } from '../src/client/section-store.ts'

function fixture() {
  const remote = { agentPresets: {
    list: vi.fn(async () => ({ ok: true as const, value: { presets: [{ id: 'standard', isDefault: true }], modeSelectionEnabled: true } })),
  }, settings: { update: vi.fn(async () => ({ ok: true as const, value: {} })) } }
  const controller = new AgentPresetSectionController({ remote } as never)
  return { remote, controller, state: () => controller.store.getSnapshot() }
}

describe('the preset roster', () => {
  it('reads the roster once for simultaneous loads and surfaces failed reads', async () => {
    const { controller, remote, state } = fixture()
    await Promise.all([controller.load(), controller.load()])
    expect(remote.agentPresets.list).toHaveBeenCalledOnce()
    expect(state()).toMatchObject({ status: 'ready', rows: [{ id: 'standard', isDefault: true }], showPicker: true })
    remote.agentPresets.list.mockRejectedValueOnce(new Error('offline'))
    await controller.load()
    expect(state()).toMatchObject({ status: 'error', error: 'offline' })
    remote.agentPresets.list.mockResolvedValueOnce({ ok: false, error: { message: 'refused' } } as never)
    await controller.load()
    expect(state().error).toBe('refused')
    remote.agentPresets.list.mockRejectedValueOnce('gone')
    await controller.load()
    expect(state().error).toBe('gone')
  })

  it('keeps default selection and blank-session synchronization on their existing settings path', async () => {
    const { controller, remote, state } = fixture()
    const sync = vi.fn(async () => undefined)
    await controller.makeDefault('standard', sync)
    expect(remote.settings.update).toHaveBeenCalledWith('agent-preset-registry', { selectedDefault: 'standard' }, undefined)
    expect(sync).toHaveBeenCalledWith('standard')
    await controller.setPickerVisible(false)
    expect(remote.settings.update).toHaveBeenLastCalledWith('agent-preset-registry', { modeSelectionEnabled: false }, undefined)
    remote.settings.update.mockRejectedValueOnce(new Error('read only'))
    await controller.setPickerVisible(true)
    expect(state()).toMatchObject({ policySaving: false, error: 'read only' })
  })

  it('prevents a second policy write and reports blank-session synchronization failures', async () => {
    const { controller, remote, state } = fixture()
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    remote.settings.update.mockImplementationOnce(async () => { await wait; return { ok: true, value: {} } })
    const pending = controller.makeDefault('standard', async () => 'Session already started')
    await controller.setPickerVisible(false)
    expect(remote.settings.update).toHaveBeenCalledOnce()
    release()
    await pending
    expect(state().error).toBe('Session already started')
    remote.agentPresets.list.mockResolvedValueOnce({ ok: true, value: { presets: [], modeSelectionEnabled: false } })
    await controller.setPickerVisible(false)
    const writes = remote.settings.update.mock.calls.length
    await controller.makeDefault('standard')
    expect(remote.settings.update).toHaveBeenCalledTimes(writes)
  })
})
