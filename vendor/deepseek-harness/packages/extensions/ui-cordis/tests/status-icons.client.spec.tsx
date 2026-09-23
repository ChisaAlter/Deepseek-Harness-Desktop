// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { CordisActionRow } from '../src/client/CordisActionRow.tsx'
import { CordisDefineRow } from '../src/client/CordisDefineRow.tsx'
import { CordisRunRow } from '../src/client/CordisRunRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh) => zh[key]) as Parameters<typeof CordisActionRow>[0]['t']

function failed(name: string): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 2, callId: `call-${name}`,
    call: { name, argsRaw: '{}' }, callTime: 1,
    content: [{ type: 'text', text: 'failed' }], isError: true, subCalls: [],
  }
}

const useValue = <T,>(value: T) => <Selected,>(selector: (snapshot: T) => Selected): Selected => selector(value)

describe('Cordis tool failure icons', () => {
  it('retains the code glyph for define and run failures', () => {
    const common = {
      openFile: vi.fn(),
      inspect: undefined,
      t,
      useInventory: useValue({ rows: [], removed: new Set(), read: true }),
      useLoaded: useValue([]),
    }
    const define = render(<CordisDefineRow {...{
      ...common, callId: 'call-cordis_define', toolName: 'cordis_define', block: failed('cordis_define'),
    } as unknown as Parameters<typeof CordisDefineRow>[0]} />)
    expect(define.container.querySelector('[data-tool="cordis_define"] [data-disclosure-row] > :first-child svg')).not.toBeNull()
    expect(define.container.querySelector('[data-tool="cordis_define"] [data-state]')).toBeNull()
    define.unmount()

    const run = render(<CordisRunRow {...{
      ...common, callId: 'call-cordis_run', toolName: 'cordis_run', block: failed('cordis_run'),
      renderSlot: vi.fn(), useRunCards: useValue(new Map()), useActiveRuns: useValue(new Map()),
      onObserveRunCard: vi.fn(),
    } as unknown as Parameters<typeof CordisRunRow>[0]} />)
    expect(run.container.querySelector('[data-tool="cordis_run"] > div:first-child > span:first-child svg')).not.toBeNull()
    expect(run.container.querySelector('[data-tool="cordis_run"] [data-state]')).toBeNull()
  })

  it('retains the code glyph for interrupted define and run calls', () => {
    const interrupted = (name: string): ToolResultNode => ({
      ...failed(name),
      error: { name: 'InterruptedError', code: 'interrupted' },
    })
    const common = {
      openFile: vi.fn(), inspect: undefined, t,
      useInventory: useValue({ rows: [], removed: new Set(), read: true }),
      useLoaded: useValue([]),
    }
    const define = render(<CordisDefineRow {...{
      ...common, callId: 'call-cordis_define', toolName: 'cordis_define', block: interrupted('cordis_define'),
    } as unknown as Parameters<typeof CordisDefineRow>[0]} />)
    expect(define.container.querySelector('[data-tool="cordis_define"] [data-disclosure-row] > :first-child svg')).not.toBeNull()
    expect(define.container.querySelector('[data-tool="cordis_define"] [data-state]')).toBeNull()
    define.unmount()

    const run = render(<CordisRunRow {...{
      ...common, callId: 'call-cordis_run', toolName: 'cordis_run', block: interrupted('cordis_run'),
      renderSlot: vi.fn(), useRunCards: useValue(new Map()), useActiveRuns: useValue(new Map()),
      onObserveRunCard: vi.fn(),
    } as unknown as Parameters<typeof CordisRunRow>[0]} />)
    expect(run.container.querySelector('[data-tool="cordis_run"] > div:first-child > span:first-child svg')).not.toBeNull()
    expect(run.container.querySelector('[data-tool="cordis_run"] [data-state]')).toBeNull()
  })

  it('uses the dashed code glyph when a successful run receipt later reports activation failure', () => {
    const pluginId = 'plugin-1'
    const packageId = 'package-1'
    const pluginRunId = 'run-1'
    const block: ToolResultNode = {
      kind: 'tool-result', seq: 3, time: 3, callId: 'call-cordis_run', callTime: 2,
      call: { name: 'cordis_run', argsRaw: JSON.stringify({ pluginId, packageId, mode: 'run' }) },
      content: [], isError: false, subCalls: [], meta: { pluginId, packageId, pluginRunId },
    }
    const view = render(<CordisRunRow {...{
      callId: block.callId, toolName: 'cordis_run', block, openFile: vi.fn(), inspect: undefined, t,
      useInventory: useValue({
        rows: [{
          pluginId, agentId: 'session-1', packages: [{
            packageId, name: 'Plugin', purpose: 'test', hasHostHalf: true, hasClientHalf: false,
          }],
          latestRun: {
            pluginRunId, packageId, mode: 'run', status: 'failed',
            host: { status: 'failed', waitingFor: [] }, client: { status: 'absent', waitingFor: [] },
            error: { phase: 'host-apply', message: 'boom', pluginId, packageId, pluginRunId },
          },
        }],
        removed: new Set(), read: true,
      }),
      useLoaded: useValue([]), renderSlot: vi.fn(), useRunCards: useValue(new Map()),
      useActiveRuns: useValue(new Map()), onObserveRunCard: vi.fn(),
    } as unknown as Parameters<typeof CordisRunRow>[0]} />)
    expect(view.container.querySelector('[data-cordis-status="failed"]')).not.toBeNull()
    expect(view.container.querySelector('[data-state="ok"] svg')).not.toBeNull()
  })

  it.each(['cordis_stop', 'cordis_undefine'] as const)('%s retains its action icon on failure', (toolName) => {
    const view = render(<CordisActionRow {...{
      callId: `call-${toolName}`, toolName, block: failed(toolName), inspect: undefined, t,
    } as unknown as Parameters<typeof CordisActionRow>[0]} />)
    expect(view.container.querySelector('[data-state="error"] svg')).not.toBeNull()
    expect(view.container.querySelector('[data-state="error"] [data-state]')).toBeNull()
  })

  it.each(['cordis_stop', 'cordis_undefine'] as const)('%s retains its action icon when interrupted', (toolName) => {
    const block: ToolResultNode = {
      ...failed(toolName),
      error: { name: 'InterruptedError', code: 'interrupted' },
    }
    const view = render(<CordisActionRow {...{
      callId: `call-${toolName}`, toolName, block, inspect: undefined, t,
    } as unknown as Parameters<typeof CordisActionRow>[0]} />)
    expect(view.container.querySelector('[data-state="stopped"] svg')).not.toBeNull()
    expect(view.container.querySelector('[data-state="stopped"] [data-state]')).toBeNull()
  })
})
