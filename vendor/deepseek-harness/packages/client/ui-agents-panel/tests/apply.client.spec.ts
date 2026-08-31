/** Agents plugin injects the panel into surfaces.agents. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { apply, inject } from '../src/client/index.ts'
import { AgentsPanel } from '../src/client/AgentsPanel.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'surfaces.agents': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const sessions = {
    open: vi.fn(),
    openSubagent: vi.fn(),
    subagentAddress: vi.fn((): SubagentAddress | undefined => undefined),
  }
  ctx.provide('sessions', sessions)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, sessions }
}

describe('ui-agents-panel apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
  })

  it('injects AgentsPanel into surfaces.agents', async () => {
    const b = await bench()
    expect(b.slots.entries('surfaces.agents')[0]?.component).toBe(AgentsPanel)
    await b.fiber.dispose()
    expect(b.slots.entries('surfaces.agents')).toHaveLength(0)
  })

  it('re-registers after the declaring slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('surfaces.agents')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('surfaces.agents')[0]?.component).toBe(AgentsPanel)
    redeclare()
    await b.fiber.dispose()
  })

  it('opens a catalog child through openSubagent when an address exists', async () => {
    const b = await bench()
    const injected = (b.slots.entries('surfaces.agents')[0]?.inject as unknown as () => {
      openAgent: (id: string) => void
    })()
    injected.openAgent('child-1')
    expect(b.sessions.open).toHaveBeenCalledWith('child-1')
    b.sessions.subagentAddress.mockReturnValueOnce({
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'child-1' as SessionId,
      mode: 'continuable',
    })
    injected.openAgent('child-1')
    expect(b.sessions.openSubagent).toHaveBeenCalledOnce()
    await b.fiber.dispose()
  })
})
