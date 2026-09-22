// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONPTY_DA1_RESPONSE,
  attachConptyDeviceAttributes,
  forgetConptyDeviceAttributes,
  isPrimaryDeviceAttributesRequest,
} from '../src/client/conpty-da.ts'

afterEach(() => {
  forgetConptyDeviceAttributes('pty-1')
  forgetConptyDeviceAttributes('pty-2')
})

function fakeTerm(): {
  handlers: Array<{ final: string; handler: (params: number[]) => boolean }>
  term: {
    parser: {
      registerCsiHandler: (
        spec: { final: string },
        handler: (params: number[]) => boolean,
      ) => { dispose: () => void }
    }
  }
} {
  const handlers: Array<{ final: string; handler: (params: number[]) => boolean }> = []
  return {
    handlers,
    term: {
      parser: {
        registerCsiHandler(spec: { final: string }, handler: (params: number[]) => boolean) {
          handlers.push({ final: spec.final, handler })
          return { dispose() { handlers.length = 0 } }
        },
      },
    },
  }
}

describe('isPrimaryDeviceAttributesRequest', () => {
  it('matches CSI c and CSI 0 c', () => {
    expect(isPrimaryDeviceAttributesRequest([])).toBe(true)
    expect(isPrimaryDeviceAttributesRequest([0])).toBe(true)
  })

  it('leaves other DA parameters to xterm', () => {
    expect(isPrimaryDeviceAttributesRequest([1])).toBe(false)
  })
})

describe('attachConptyDeviceAttributes', () => {
  it('answers primary DA with the ConPTY sequence and swallows xterm ?1;2c', () => {
    const writeToPty = vi.fn()
    const { handlers, term } = fakeTerm()
    const sub = attachConptyDeviceAttributes(term, writeToPty, 'pty-1')
    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.final).toBe('c')
    expect(handlers[0]?.handler([])).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith(CONPTY_DA1_RESPONSE)
    expect(CONPTY_DA1_RESPONSE).toBe('\x1b[?61;4c')
    expect(handlers[0]?.handler([1])).toBe(false)
    expect(writeToPty).toHaveBeenCalledTimes(1)
    sub.dispose()
    expect(handlers).toHaveLength(0)
  })

  it('does not write DA1 to the PTY again for the same session after remount replay', () => {
    const writeToPty = vi.fn()
    const first = fakeTerm()
    attachConptyDeviceAttributes(first.term, writeToPty, 'pty-1')
    expect(first.handlers[0]?.handler([])).toBe(true)
    const second = fakeTerm()
    attachConptyDeviceAttributes(second.term, writeToPty, 'pty-1')
    expect(second.handlers[0]?.handler([])).toBe(true)
    expect(writeToPty).toHaveBeenCalledTimes(1)
  })

  it('answers DA1 again after the PTY session is forgotten', () => {
    const writeToPty = vi.fn()
    const first = fakeTerm()
    attachConptyDeviceAttributes(first.term, writeToPty, 'pty-1')
    expect(first.handlers[0]?.handler([])).toBe(true)
    forgetConptyDeviceAttributes('pty-1')
    const second = fakeTerm()
    attachConptyDeviceAttributes(second.term, writeToPty, 'pty-1')
    expect(second.handlers[0]?.handler([])).toBe(true)
    expect(writeToPty).toHaveBeenCalledTimes(2)
  })
})
