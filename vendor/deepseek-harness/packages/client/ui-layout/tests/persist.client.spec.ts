// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LAYOUT_PERSIST_KEY,
  lastDrawerHeight,
  lastSurfacesWidth,
  readLayoutPersist,
  writeLayoutPersist,
} from '../src/client/persist.ts'
import { SURFACES_DEFAULT, TERMINAL_DRAWER_DEFAULT } from '../src/client/columns.ts'

beforeEach(() => { localStorage.clear() })

describe('layout persist', () => {
  it('returns undefined for missing or malformed JSON', () => {
    expect(readLayoutPersist()).toBeUndefined()
    localStorage.setItem(LAYOUT_PERSIST_KEY, '{')
    expect(readLayoutPersist()).toBeUndefined()
    localStorage.setItem(LAYOUT_PERSIST_KEY, 'null')
    expect(readLayoutPersist()).toBeUndefined()
  })

  it('clamps open sizes and treats 0 as closed', () => {
    writeLayoutPersist({ lastSurfaces: 1, lastDrawer: 1, surfaces: 0, terminalDrawer: 0 })
    expect(readLayoutPersist()).toEqual({
      lastSurfaces: 360,
      lastDrawer: 180,
      surfaces: 0,
      terminalDrawer: 0,
    })
    expect(lastSurfacesWidth()).toBe(360)
    expect(lastDrawerHeight()).toBe(180)
  })

  it('falls back to contract defaults when last sizes are missing', () => {
    localStorage.setItem(LAYOUT_PERSIST_KEY, JSON.stringify({ surfaces: 500, terminalDrawer: 300 }))
    const next = readLayoutPersist()
    expect(next?.lastSurfaces).toBe(SURFACES_DEFAULT)
    expect(next?.lastDrawer).toBe(TERMINAL_DRAWER_DEFAULT)
    expect(next?.surfaces).toBe(500)
    expect(next?.terminalDrawer).toBe(300)
  })

  it('swallows a storage write failure', () => {
    const store = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      length: 0,
      clear: () => {},
      key: () => null,
      removeItem: () => {},
    } as Storage
    expect(() => { writeLayoutPersist({ surfaces: 500 }, store) }).not.toThrow()
  })

  it('no-ops when storage is missing', () => {
    expect(readLayoutPersist(undefined)).toBeUndefined()
    writeLayoutPersist({ surfaces: 500 }, undefined)
    expect(lastSurfacesWidth(undefined)).toBe(SURFACES_DEFAULT)
    expect(lastDrawerHeight(undefined)).toBe(TERMINAL_DRAWER_DEFAULT)
  })
})
