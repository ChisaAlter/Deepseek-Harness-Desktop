// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DshdMiniPlayer } from '../src/client/DshdMiniPlayer.tsx'
import { en } from '../src/client/locales.ts'
import { clearMiniPlayer, openMiniPlayer, setMiniPlayerRuntime } from '../src/client/mini-player-state.ts'

const t = (key: keyof typeof en): string => en[key]

afterEach(() => { clearMiniPlayer(); cleanup() })

describe('dshd mini-player', () => {
  it('shows the same preview through the overlay and restores it', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches?.('[data-preview-mini-player-viewport]')) return { left: 0, top: 28, width: 300, height: 152, right: 300, bottom: 180 } as DOMRect
      if (this.matches?.('[data-preview-mini-player]')) return { left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200 } as DOMRect
      return originalRect.call(this)
    }
    const previewShow = vi.fn(async () => {})
    const previewResize = vi.fn(async () => {})
    const previewHide = vi.fn(async () => {})
    const restore = vi.fn()
    const frame = document.createElement('div')
    frame.dataset.shellOverlay = ''
    const chat = document.createElement('div')
    chat.dataset.conversationScroll = ''
    Object.defineProperty(chat, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) })
    frame.append(chat)
    document.body.append(frame)
    setMiniPlayerRuntime('preview-1', { previewShow, previewResize, previewHide, restore })
    openMiniPlayer('preview-1')
    render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
    await waitFor(() => expect(previewShow).toHaveBeenCalled())
    expect(previewShow).toHaveBeenCalledWith('preview-1', expect.anything())
    expect(screen.getByRole('region', { name: 'dshd mini-player' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.miniRestore }))
    expect(restore).toHaveBeenCalledTimes(1)
    HTMLElement.prototype.getBoundingClientRect = originalRect
  })
})
