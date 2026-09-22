/** Desktop wallpaper catalog callbacks used by Appearance. */

/** One wallpaper row from Bing or a custom catalog. */
export type WallpaperCatalogItem = {
  id: string
  title: string
  copyright: string
  thumbUrl: string
  imageUrl: string
  source: string
}

/** Merged catalog returned by the desktop shell. */
export type WallpaperCatalog = {
  items?: WallpaperCatalogItem[]
  warning?: string
  nextPage?: number
}

/** Download result from the desktop main-process proxy. */
export type WallpaperDownload = {
  dataUrl?: string
  error?: string
}

/** Desktop APIs for listing and downloading wallpapers. */
export type WallpaperShell = {
  listWallpaperCatalog: (query: {
    kind: 'bing' | 'wallhaven' | 'catalog'
    year?: number
    url?: string
    q?: string
    categories?: '100' | '010' | '001'
    page?: number
  }) => Promise<WallpaperCatalog>
  downloadWallpaper: (url: string) => Promise<WallpaperDownload>
}

type WindowWithShell = Window & { shell?: Partial<WallpaperShell> }

/**
 * Read wallpaper catalog APIs from the desktop preload bridge.
 * @returns the APIs when both list and download are present, otherwise null.
 */
export function wallpaperShell(): WallpaperShell | null {
  /* v8 ignore next -- the browser bundle always has window */
  if (typeof window === 'undefined') return null
  const api = (window as WindowWithShell).shell
  if (api?.listWallpaperCatalog === undefined || api.downloadWallpaper === undefined) return null
  return { listWallpaperCatalog: api.listWallpaperCatalog, downloadWallpaper: api.downloadWallpaper }
}
