// @vitest-environment jsdom
/** Desktop wallpaper catalog bridge. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { wallpaperShell, type WallpaperShell } from '../src/client/wallpaper-shell.ts'

type ShellWindow = Window & {
  shell?: Partial<WallpaperShell>
}

describe('wallpaperShell', () => {
  it('returns null without both catalog APIs', () => {
    const host = window as ShellWindow
    delete host.shell
    expect(wallpaperShell()).toBeNull()
    host.shell = { listWallpaperCatalog: async () => ({ items: [] }) }
    expect(wallpaperShell()).toBeNull()
    host.shell = { downloadWallpaper: async () => ({}) }
    expect(wallpaperShell()).toBeNull()
    delete host.shell
  })

  it('types listWallpaperCatalog with a kind query, not includeBing', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/ui-theme/src/client/wallpaper-shell.ts'), 'utf8')
    expect(source).not.toMatch(/\bincludeBing\b/)
    expect(source).not.toMatch(/\bcatalogs\?:/)
    expect(source).toMatch(/kind: 'bing' \| 'wallhaven' \| 'catalog'/)
    expect(source).toMatch(/nextPage\?: number/)
  })

  it('returns the preload list and download functions when both exist', async () => {
    const listWallpaperCatalog: WallpaperShell['listWallpaperCatalog'] = async (query) => {
      expect(query).toEqual({ kind: 'bing', year: 2024 })
      return { items: [], nextPage: 2 }
    }
    const downloadWallpaper = async () => ({ dataUrl: 'data:image/jpeg;base64,xx' })
    const host = window as ShellWindow
    host.shell = { listWallpaperCatalog, downloadWallpaper }
    const api = wallpaperShell()
    expect(api).not.toBeNull()
    expectTypeOf(api!.listWallpaperCatalog).parameter(0).toMatchTypeOf<{
      kind: 'bing' | 'wallhaven' | 'catalog'
      year?: number
      url?: string
      q?: string
      categories?: '100' | '010' | '001'
      page?: number
    }>()
    expectTypeOf(api!.listWallpaperCatalog).parameter(0).not.toHaveProperty('includeBing')
    expectTypeOf(api!.listWallpaperCatalog).parameter(0).not.toHaveProperty('catalogs')
    await expect(api?.listWallpaperCatalog({ kind: 'bing', year: 2024 })).resolves.toEqual({
      items: [],
      nextPage: 2,
    })
    await expect(api?.downloadWallpaper('https://example.com/a.jpg')).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,xx',
    })
    delete host.shell
  })
})
