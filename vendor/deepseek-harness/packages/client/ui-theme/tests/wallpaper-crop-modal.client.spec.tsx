// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WallpaperCropModal } from '../src/client/WallpaperCropModal.tsx'
import { cropWallpaper } from '../src/wallpaper.ts'
import { zh, type ThemeKey } from '../src/client/locales.ts'

vi.mock('../src/wallpaper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/wallpaper.ts')>()
  return { ...actual, cropWallpaper: vi.fn() }
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const CROPPED = 'data:image/png;base64,Y3JvcA=='

describe('WallpaperCropModal', () => {
  beforeEach(() => {
    vi.mocked(cropWallpaper).mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not confirm after cancel even when open stays true', async () => {
    let finish!: (value: string | null) => void
    vi.mocked(cropWallpaper).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const onConfirm = vi.fn()
    const t = (key: ThemeKey) => zh[key]
    render(
      <WallpaperCropModal
        open={true}
        image={PNG}
        t={t}
        onClose={() => { /* parent has not flipped open yet */ }}
        onConfirm={onConfirm}
      />,
    )
    const crop = screen.getByRole('dialog', { name: zh['wallpaper.crop'] })
    const img = crop.querySelector('img')
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true })
      Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true })
      fireEvent.load(img)
    }
    fireEvent.click(within(crop).getByRole('button', { name: zh['wallpaper.use'] }))
    await vi.waitFor(() => { expect(cropWallpaper).toHaveBeenCalled() })
    fireEvent.click(within(crop).getByRole('button', { name: zh['editor.cancel'] }))
    await act(async () => { finish(CROPPED) })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
