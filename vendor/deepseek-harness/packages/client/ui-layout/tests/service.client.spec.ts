import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    setSurfaces: vi.fn(),
    toggleSurfaces: vi.fn(),
    openSurfaces: vi.fn(),
    closeSurfaces: vi.fn(),
    toggleTerminalDrawer: vi.fn(),
    setTerminalDrawer: vi.fn(),
    closeNarrowSidebar: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('forwards surfaces and terminal-drawer actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSurfaces()
    service.openSurfaces()
    service.closeSurfaces()
    service.toggleTerminalDrawer()
    service.setTerminalDrawer(240)

    expect(panels.toggleSurfaces).toHaveBeenCalledTimes(1)
    expect(panels.openSurfaces).toHaveBeenCalledTimes(1)
    expect(panels.closeSurfaces).toHaveBeenCalledTimes(1)
    expect(panels.toggleTerminalDrawer).toHaveBeenCalledTimes(1)
    expect(panels.setTerminalDrawer).toHaveBeenCalledTimes(1)
    expect(panels.setTerminalDrawer).toHaveBeenCalledWith(240)
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.toggleSurfaces() }).toThrow(/panel actions not wired/)
    expect(() => { service.toggleTerminalDrawer() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
