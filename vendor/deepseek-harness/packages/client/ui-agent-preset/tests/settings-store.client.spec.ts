/**
 * The agent-preset settings controller: it derives both the options and the
 * current default from one roster call, writes only the `default` field, and
 * treats an empty roster as "this deployment composes no presets" rather than
 * as a failure.
 */

import { describe, expect, it } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsWireFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController, messageOf,
} from '../src/client/settings-store.ts'

/** The two faces the row reads: the roster Remote and the settings wire. */
interface FakeWire {
  api: SettingsWireFace
  remote: Pick<ClientRemote, 'agentPresets'>
}

/** Controller over a real mirror derived from the same fake wire. */
function derivedController(wire: FakeWire) {
  return new AgentPresetSettingsController(wire.api, wire.remote, new SettingsDescribeMirror(wire.api))
}
import { AgentPresetSeatController } from '../src/client/seat-store.ts'

type SeatSession = Pick<SessionSummary, 'id' | 'blank' | 'projectionValues'>

interface Recorded { ns: string; ops: unknown }

/** A roster Remote answering a fixed set of rows, or refusing. */
function fakeRoster(
  presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[],
  options: { failList?: string; failListCode?: string; throwOnList?: boolean } = {},
): Pick<ClientRemote, 'agentPresets'> {
  return {
    agentPresets: {
      list: () => {
        if (options.throwOnList === true) return Promise.reject(new Error('socket closed'))
        return Promise.resolve(options.failList === undefined
          ? { ok: true as const, value: { presets, authorable: true } }
          : {
            ok: false as const,
            error: { code: options.failListCode ?? 'internal', message: options.failList, details: {} },
          })
      },
    },
  } as unknown as Pick<ClientRemote, 'agentPresets'>
}

/** A wire whose roster and write outcome the test controls. */
function fakeApi(
  presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[],
  options: {
    writes?: Recorded[]
    failWrite?: string
    failList?: string
    failWriteWith?: Error
    readOnly?: boolean
  } = {},
): FakeWire {
  const api = {
    settings: {
      // Host persistence is enabled in production only on the selected client path; a read-only provider answers writable:false
      // and the row disables its control instead of offering a refused write.
      describe: () => Promise.resolve({
        ok: true as const,
        value: { writable: options.readOnly !== true, hasDocument: true, namespaces: [] },
      }),
      update: (ns: string, patch: { default?: unknown }) => {
        options.writes?.push({ ns, ops: patch })
        if (options.failWriteWith !== undefined) return Promise.reject(options.failWriteWith)
        if (options.failWrite !== undefined) {
          return Promise.resolve({ ok: false as const, error: { code: 'internal', message: options.failWrite, details: {} } })
        }
        // A committed write moves the roster's default.
        for (const preset of presets) {
          preset.isDefault = preset.id === patch.default
        }
        return Promise.resolve({ ok: true as const, value: {} })
      },
    },
  } as unknown as SettingsWireFace
  return {
    api,
    remote: fakeRoster(presets, options.failList === undefined ? {} : { failList: options.failList }),
  }
}

describe('the agent-preset settings controller', () => {
  it('disables the control when this browser may not write settings', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
    ], { readOnly: true }))

    await controller.load()

    // The enabled `settings.describe` path reports a read-only provider;
    // offering a control whose write answers `settings-rejected` would promise
    // a switch the host refuses.
    expect(controller.store.getSnapshot().writable).toBe(false)
    expect(controller.store.getSnapshot().currentValue).toBe('standard')
  })

  it('derives options and the current default from one roster call', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'mine', trust: 'user', isDefault: false },
    ]))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.currentValue).toBe('standard')
    expect(state.options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'mine', trust: 'user' },
    ])
  })

  it('offers no broken preset: the pickers choose the NEXT session\'s composition', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'damaged', trust: 'user', isDefault: false, broken: 'the composition is not valid YAML' },
    ] as never))

    await controller.load()

    // A broken preset cannot compose a session; listing it here would defer
    // that discovery to a failed session start. The management section shows
    // (and deletes) it from its own store instead.
    expect(controller.store.getSnapshot().options.map(option => option.id)).toEqual(['standard'])
  })

  it('carries the display metadata a preset published', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    ] as never))

    await controller.load()

    // Surfaces beyond this row read the same options; the id alone never said
    // what a preset does.
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    ])
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    const controller = derivedController(fakeApi([]))

    await controller.load()

    // A deployment composing no presets is valid: every session shares the
    // host composition and the row renders nothing.
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    expect(controller.store.getSnapshot().error).toBeNull()
  })

  it('treats an unavailable optional namespace as an empty roster', async () => {
    const controller = derivedController({
      api: {} as SettingsWireFace,
      remote: fakeRoster([], {
        failList: 'no active Remote method exports this endpoint',
        failListCode: 'invocation-unavailable',
      }),
    })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: null, options: [] })
  })

  it('writes only the default field, into the agent-presets namespace', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ], { writes }))
    await controller.load()

    await controller.select('minimal')

    expect(writes).toEqual([{
      ns: AGENT_PRESET_SETTINGS_NS,
      ops: { default: 'minimal' },
    }])
    expect(controller.store.getSnapshot().currentValue).toBe('minimal')
  })

  it('restores the previous value and surfaces the message when the write fails', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ], { failWrite: 'read-only settings' }))
    await controller.load()

    await controller.select('minimal')

    const state = controller.store.getSnapshot()
    expect(state.currentValue).toBe('standard')
    expect(state.error).toBe('read-only settings')
    expect(state.status).toBe('ready')
  })

  it('ignores a pick that is already the default', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
    ], { writes }))
    await controller.load()

    await controller.select('standard')

    expect(writes).toEqual([])
  })

  it('surfaces a roster failure without claiming the deployment has no presets', async () => {
    const controller = derivedController(fakeApi([], { failList: 'host down' }))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('host down')
  })

  it('shows the first preset when the roster marks none default', async () => {
    // Settings can name a preset that was since deleted; the picker still has
    // to show something rather than an empty control.
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'mine', trust: 'user', isDefault: false },
    ]))

    await controller.load()

    expect(controller.store.getSnapshot().currentValue).toBe('standard')
  })

  it('ignores a load while one is already in flight', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi(
      [{ id: 'standard', trust: 'system', isDefault: true }], { writes }))

    await Promise.all([controller.load(), controller.load()])

    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('reads an Error\'s message and stringifies anything else', () => {
    // A transport rejects with an Error, but a host or a runtime can reject
    // with anything and the surface still has to say something.
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf({ code: 7 })).toBe('[object Object]')
  })

  it('reports a transport that rejects rather than answering', async () => {
    const controller = derivedController({
      api: {} as SettingsWireFace,
      remote: fakeRoster([], { throwOnList: true }),
    })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'socket closed' })
  })

  it('reports a transport that rejects mid-write and keeps the old default showing', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'mine', trust: 'user', isDefault: false },
    ], { failWriteWith: new Error('socket closed') }))
    await controller.load()

    await controller.select('mine')

    // The value snaps back because the host never took it; a picker still
    // showing "mine" would be claiming a default that does not exist.
    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'standard', error: 'socket closed' })
  })
})

describe('the new-session chip controller', () => {
  /** A chip over a current session the test can move. */
  function chip(
    presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[],
    current: SeatSession | undefined | (() => SeatSession | undefined),
    options: {
      writes?: Recorded[]
      failSelect?: string
      failList?: string
      failListCode?: string
      throwOn?: 'list' | 'select'
    } = {},
  ): AgentPresetSeatController {
    const remote = {
      agentPresets: {
        list: () => {
          if (options.throwOn === 'list') return Promise.reject(new Error('socket closed'))
          return Promise.resolve(options.failList === undefined
            ? { ok: true as const, value: { presets, authorable: true } }
            : {
              ok: false as const,
              error: { code: options.failListCode ?? 'internal', message: options.failList, details: {} },
            })
        },
        select: (agentId: SessionId, agentPreset: string) => {
          if (options.throwOn === 'select') return Promise.reject(new Error('socket closed'))
          options.writes?.push({ ns: 'select', ops: agentPreset })
          return Promise.resolve(options.failSelect === undefined
            ? { ok: true as const, value: agentPreset }
            : {
              ok: false as const,
              error: {
                code: 'agent-preset-locked',
                message: options.failSelect,
                details: { sessionId: agentId, agentPreset },
              },
            })
        },
      },
    } as unknown as Pick<ClientRemote, 'agentPresets'>
    return new AgentPresetSeatController(
      remote,
      typeof current === 'function' ? current : () => current,
    )
  }

  const ROSTER: { id: string; trust: 'system' | 'user'; isDefault: boolean }[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'minimal', trust: 'system', isDefault: false },
  ]

  it('opens on the deployment default', async () => {
    const controller = chip(ROSTER, undefined)

    await controller.load()

    // The chip names the session about to start, and nothing about it is
    // decided yet — the default is the honest opening value.
    expect(controller.store.getSnapshot().current).toBe('standard')
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'minimal', trust: 'system' },
    ])
  })

  it('shows the first preset when the roster marks none default', async () => {
    const controller = chip([{ id: 'minimal', trust: 'system', isDefault: false }], undefined)

    await controller.load()

    // Settings can name a preset that was since deleted; the chip still has
    // to open on something rather than render nothing.
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('carries the display metadata into the menu rows', async () => {
    const controller = chip([
      { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    ] as never, undefined)

    await controller.load()

    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    ])
  })

  it('opens on nothing when the deployment composes no presets', async () => {
    const controller = chip([], undefined)

    await controller.load()

    // An empty roster is a valid deployment: every session shares the host
    // composition, and the chip renders nothing rather than an empty control.
    expect(controller.store.getSnapshot().current).toBe('')
  })

  it('opens on nothing when the optional namespace is unavailable', async () => {
    const controller = chip([], undefined, {
      failList: 'no active Remote method exports this endpoint',
      failListCode: 'invocation-unavailable',
    })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ current: '', error: null, options: [] })
  })

  it('stages a pick made before any session exists', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, undefined, { writes })
    await controller.load()

    await controller.select('minimal')

    // Nothing to switch yet: the new-session screen precedes the session.
    expect(writes).toEqual([])
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('replaces the default display when an existing blank session arrives after roster load', async () => {
    const state: { current?: SeatSession } = {}
    const controller = chip([
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'minimal', trust: 'system', isDefault: true },
    ], () => state.current)
    await controller.load()
    expect(controller.store.getSnapshot().current).toBe('minimal')

    state.current = {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }
    await controller.apply()

    expect(controller.store.getSnapshot().current).toBe('standard')
  })

  it('applies the stage to the blank session the flow lands on', async () => {
    const writes: Recorded[] = []
    const current = {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }
    const controller = chip(ROSTER, current, { writes })
    await controller.load()
    await controller.select('minimal')

    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('spends the stage exactly once', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()
    await controller.select('minimal')

    await controller.apply()
    await controller.apply()

    // Every later list movement calls apply(); an unspent stage would keep
    // switching sessions the user never picked for.
    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
  })

  it('drops the stage against a session that already started', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()

    await controller.select('minimal')

    // The host enforces the same rule; the chip simply never asks.
    expect(writes).toEqual([])
  })

  it('drops the stage when the session already runs it', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'minimal' },
    }, { writes })
    await controller.load()

    await controller.select('minimal')

    expect(writes).toEqual([])
  })

  it('falls back to the default when the host refuses the switch', async () => {
    const controller = chip(
      ROSTER,
      {
        id: 's1' as SessionId,
        blank: true,
        projectionValues: { agentPreset: 'standard' },
      },
      { failSelect: 'already started' },
    )
    await controller.load()

    await controller.select('minimal')

    // Showing `minimal` after a refusal would claim a composition the session
    // never got.
    expect(controller.store.getSnapshot()).toMatchObject({ current: 'standard', error: 'already started' })
  })

  it('falls back to the default when the switch never reaches the host', async () => {
    const controller = chip(
      ROSTER,
      {
        id: 's1' as SessionId,
        blank: true,
        projectionValues: { agentPreset: 'standard' },
      },
      { throwOn: 'select' },
    )
    await controller.load()

    await controller.select('minimal')

    expect(controller.store.getSnapshot())
      .toMatchObject({ current: 'standard', busy: false, error: 'socket closed' })
  })

  it('ignores a pick while a switch is in flight', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()

    const first = controller.select('minimal')
    await controller.select('standard')
    await first

    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
  })

  it('keeps a staged pick across a roster refresh', async () => {
    const controller = chip(ROSTER, undefined)
    await controller.load()
    await controller.select('minimal')

    await controller.load()

    // A settings push re-reads the roster; it must not silently discard what
    // the user picked for the session they are about to start.
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('reports a refused roster read without emptying the chip', async () => {
    const controller = chip(ROSTER, undefined, { failList: 'host down' })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ error: 'host down', options: [] })
  })

  it('reports a transport that rejects the roster read', async () => {
    const controller = chip(ROSTER, undefined, { throwOn: 'list' })

    await controller.load()

    expect(controller.store.getSnapshot().error).toBe('socket closed')
  })

  it('degrades to a read-only row while the mirror holds no answer', async () => {
    const controller = derivedController({
      // The roster answered; the mirror's read is what failed, so the row
      // shows the current default without offering a write it never confirmed.
      api: { settings: { describe: () => Promise.reject(new Error('socket closed')) } } as unknown as SettingsWireFace,
      remote: fakeRoster([{ id: 'standard', trust: 'system', isDefault: true }]),
    })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: false,
      currentValue: 'standard',
    })
  })


})
