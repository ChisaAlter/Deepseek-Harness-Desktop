/** Device-toolbar viewport layout. Guest `previewResize` uses the visible rectangle. */

export type PreviewViewportSetting =
  | { readonly _tag: 'fill' }
  | { readonly _tag: 'preset'; readonly presetId: string; readonly width: number; readonly height: number }
  | { readonly _tag: 'freeform'; readonly width: number; readonly height: number }

/** Integer width and height in CSS pixels. */
export interface PreviewViewportSize {
  readonly width: number
  readonly height: number
}

/** Guest BrowserView rectangle in window content coordinates. */
export interface PreviewGuestBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Visible guest footprint inside the preview host after fit-to-panel scaling. */
export interface BrowserViewportLayout {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly viewportX: number
  readonly viewportY: number
  /** Visible footprint inside the preview panel after fit-to-panel scaling. Applied as BrowserView `setBounds`, not a CSS transform. */
  readonly viewportWidth: number
  readonly viewportHeight: number
  /**
   * Fit-to-panel scale of the requested CSS size × zoom.
   * Applied by sizing the BrowserView to `viewportWidth` × `viewportHeight`, not a CSS transform and not CDP device metrics.
   */
  readonly viewportScale: number
  readonly fillsPanel: boolean
}

export const BROWSER_DEVICE_TOOLBAR_HEIGHT = 32
export const BROWSER_VIEWPORT_RESIZE_RAIL_SIZE = 10
export const PREVIEW_VIEWPORT_MIN_DIMENSION = 240
export const PREVIEW_VIEWPORT_MAX_DIMENSION = 3840
export const PREVIEW_VIEWPORT_MAX_AREA = 3840 * 2160

export type BrowserViewportResizeDirection =
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'

/**
 * Stable identity for a viewport setting, used to drop stale rail drags.
 * @param setting - fill, preset, or freeform viewport.
 * @returns a comparable key string.
 */
export const browserViewportSettingKey = (setting: PreviewViewportSetting): string =>
  setting._tag === 'fill'
    ? 'fill'
    : `${setting._tag}:${setting.width}:${setting.height}:${setting._tag === 'preset' ? setting.presetId : ''}`

const normalizeZoomFactor = (zoomFactor: number): number =>
  Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

/**
 * Convert fill mode into a freeform size, or keep an already sized setting.
 * @param setting - current viewport setting.
 * @param sourceContent - last fitted guest footprint, or null.
 * @param zoomFactor - live page zoom, default 1.
 * @returns a non-fill setting.
 */
export function resolveFittedBrowserViewport(
  setting: PreviewViewportSetting,
  sourceContent: {
    readonly width: number
    readonly height: number
    readonly scale: number
  } | null,
  zoomFactor = 1,
): Exclude<PreviewViewportSetting, { readonly _tag: 'fill' }> {
  if (setting._tag !== 'fill') return setting
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor)
  if (sourceContent) {
    return {
      _tag: 'freeform',
      width: Math.max(
        1,
        Math.round(sourceContent.width / sourceContent.scale / normalizedZoomFactor),
      ),
      height: Math.max(
        1,
        Math.round(sourceContent.height / sourceContent.scale / normalizedZoomFactor),
      ),
    }
  }
  return { _tag: 'freeform', width: 1280, height: 800 }
}

/**
 * Device-mode area inside the host after toolbar and 10px rails.
 * @param container - full host width and height.
 * @returns the area the guest may occupy.
 */
export function resolveBrowserDeviceViewportArea(container: {
  readonly width: number
  readonly height: number
}): PreviewViewportSize {
  return {
    width: Math.max(1, container.width - BROWSER_VIEWPORT_RESIZE_RAIL_SIZE * 2),
    height: Math.max(
      1,
      container.height - BROWSER_DEVICE_TOOLBAR_HEIGHT - BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
    ),
  }
}

/**
 * Center and optionally scale a setting inside a rectangle (no toolbar chrome).
 * @param container - available width and height.
 * @param setting - fill, preset, or freeform.
 * @param zoomFactor - live page zoom, default 1.
 * @returns canvas size plus guest origin, size, and scale.
 */
export function resolveBrowserViewportLayout(
  container: { readonly width: number; readonly height: number },
  setting: PreviewViewportSetting,
  zoomFactor = 1,
): BrowserViewportLayout {
  const containerWidth = Math.max(1, Math.round(container.width))
  const containerHeight = Math.max(1, Math.round(container.height))
  if (setting._tag === 'fill') {
    return {
      canvasWidth: containerWidth,
      canvasHeight: containerHeight,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: containerWidth,
      viewportHeight: containerHeight,
      viewportScale: 1,
      fillsPanel: true,
    }
  }
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor)
  const renderedWidth = setting.width * normalizedZoomFactor
  const renderedHeight = setting.height * normalizedZoomFactor
  const viewportScale = Math.min(
    1,
    containerWidth / renderedWidth,
    containerHeight / renderedHeight,
  )
  const viewportWidth = renderedWidth * viewportScale
  const viewportHeight = renderedHeight * viewportScale
  return {
    canvasWidth: containerWidth,
    canvasHeight: containerHeight,
    viewportX: Math.max(0, Math.round((containerWidth - viewportWidth) / 2)),
    viewportY: Math.max(0, Math.round((containerHeight - viewportHeight) / 2)),
    viewportWidth,
    viewportHeight,
    viewportScale,
    fillsPanel: false,
  }
}

/**
 * Device-mode layout: toolbar on top, rails inset, then the fill/fit layout inside that area.
 * @param container - full host width and height.
 * @param setting - preset or freeform (never fill).
 * @param zoomFactor - live page zoom, default 1.
 * @returns layout in host coordinates, including toolbar and rail offsets.
 */
export function resolveBrowserDeviceViewportLayout(
  container: { readonly width: number; readonly height: number },
  setting: Exclude<PreviewViewportSetting, { readonly _tag: 'fill' }>,
  zoomFactor = 1,
): BrowserViewportLayout {
  const layout = resolveBrowserViewportLayout(
    resolveBrowserDeviceViewportArea(container),
    setting,
    zoomFactor,
  )
  return {
    ...layout,
    canvasWidth: Math.max(1, Math.round(container.width)),
    canvasHeight: Math.max(1, Math.round(container.height)),
    viewportX: layout.viewportX + BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
    viewportY: layout.viewportY + BROWSER_DEVICE_TOOLBAR_HEIGHT,
  }
}

/**
 * Map occupant host bounds plus a setting to the BrowserView `setBounds` rectangle.
 * Fill uses the full occupant. Sized settings use device-toolbar layout (toolbar + rails).
 * @param occupant - host rectangle in window content coordinates.
 * @param setting - fill (toolbar off) or a sized setting (toolbar on).
 * @param zoomFactor - live page zoom, default 1.
 * @returns integer guest bounds for `previewResize` / `previewShow`.
 */
export function resolvePreviewGuestBounds(
  occupant: PreviewGuestBounds,
  setting: PreviewViewportSetting,
  zoomFactor = 1,
): PreviewGuestBounds {
  if (setting._tag === 'fill') {
    return {
      x: occupant.x,
      y: occupant.y,
      width: occupant.width,
      height: occupant.height,
    }
  }
  const layout = resolveBrowserDeviceViewportLayout(
    { width: occupant.width, height: occupant.height },
    setting,
    zoomFactor,
  )
  return {
    x: occupant.x + layout.viewportX,
    y: occupant.y + layout.viewportY,
    width: Math.round(layout.viewportWidth),
    height: Math.round(layout.viewportHeight),
  }
}

const clampViewportDimension = (value: number): number =>
  Math.min(PREVIEW_VIEWPORT_MAX_DIMENSION, Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, value))

const validAspectRatio = (aspectRatio: number | undefined): aspectRatio is number =>
  aspectRatio !== undefined && Number.isFinite(aspectRatio) && aspectRatio > 0

function resizeAtAspectRatio(
  desired: number,
  aspectRatio: number,
  primaryAxis: 'width' | 'height',
): PreviewViewportSize {
  if (primaryAxis === 'width') {
    const minimum = Math.ceil(
      Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, PREVIEW_VIEWPORT_MIN_DIMENSION * aspectRatio),
    )
    const maximum = Math.floor(
      Math.min(
        PREVIEW_VIEWPORT_MAX_DIMENSION,
        PREVIEW_VIEWPORT_MAX_DIMENSION * aspectRatio,
        Math.sqrt(PREVIEW_VIEWPORT_MAX_AREA * aspectRatio),
      ),
    )
    let width = Math.min(maximum, Math.max(minimum, Math.round(desired)))
    let height = Math.round(width / aspectRatio)
    while (width * height > PREVIEW_VIEWPORT_MAX_AREA && width > minimum) {
      width -= 1
      height = Math.round(width / aspectRatio)
    }
    return { width, height }
  }

  const minimum = Math.ceil(
    Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, PREVIEW_VIEWPORT_MIN_DIMENSION / aspectRatio),
  )
  const maximum = Math.floor(
    Math.min(
      PREVIEW_VIEWPORT_MAX_DIMENSION,
      PREVIEW_VIEWPORT_MAX_DIMENSION / aspectRatio,
      Math.sqrt(PREVIEW_VIEWPORT_MAX_AREA / aspectRatio),
    ),
  )
  let height = Math.min(maximum, Math.max(minimum, Math.round(desired)))
  let width = Math.round(height * aspectRatio)
  while (width * height > PREVIEW_VIEWPORT_MAX_AREA && height > minimum) {
    height -= 1
    width = Math.round(height * aspectRatio)
  }
  return { width, height }
}

/**
 * Apply a pointer or typed delta to a freeform size, with optional aspect lock.
 * @param start - size before the delta.
 * @param delta - pointer delta in host pixels (already direction-signed by the caller for rails).
 * @param zoomFactor - live page zoom, default 1.
 * @param direction - which edges the delta controls, default southeast.
 * @param aspectRatio - locked width/height ratio, or omitted.
 * @returns a clamped freeform size.
 */
export function resizeFreeformViewport(
  start: PreviewViewportSize,
  delta: { readonly x: number; readonly y: number },
  zoomFactor = 1,
  direction: BrowserViewportResizeDirection = 'southeast',
  aspectRatio?: number,
): PreviewViewportSize {
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor)
  const horizontalDelta = direction.includes('east')
    ? delta.x
    : direction.includes('west')
      ? -delta.x
      : 0
  const verticalDelta = direction.includes('south')
    ? delta.y
    : direction.includes('north')
      ? -delta.y
      : 0
  const desiredWidth = start.width + horizontalDelta / normalizedZoomFactor
  const desiredHeight = start.height + verticalDelta / normalizedZoomFactor
  if (validAspectRatio(aspectRatio)) {
    const controlsWidth = horizontalDelta !== 0 || direction === 'east' || direction === 'west'
    const controlsHeight = verticalDelta !== 0 || direction === 'north' || direction === 'south'
    const primaryAxis =
      controlsWidth && !controlsHeight
        ? 'width'
        : controlsHeight && !controlsWidth
          ? 'height'
          : Math.abs(desiredWidth - start.width) / start.width >=
              Math.abs(desiredHeight - start.height) / start.height
            ? 'width'
            : 'height'
    return resizeAtAspectRatio(
      primaryAxis === 'width' ? desiredWidth : desiredHeight,
      aspectRatio,
      primaryAxis,
    )
  }
  let width = clampViewportDimension(Math.round(desiredWidth))
  let height = clampViewportDimension(Math.round(desiredHeight))
  if (width * height <= PREVIEW_VIEWPORT_MAX_AREA) return { width, height }
  if (Math.abs(horizontalDelta) >= Math.abs(verticalDelta)) {
    width = Math.max(
      PREVIEW_VIEWPORT_MIN_DIMENSION,
      Math.floor(PREVIEW_VIEWPORT_MAX_AREA / height),
    )
  } else {
    height = Math.max(
      PREVIEW_VIEWPORT_MIN_DIMENSION,
      Math.floor(PREVIEW_VIEWPORT_MAX_AREA / width),
    )
  }
  return { width, height }
}

const resizeFromEndRail = (start: number, pointerDelta: number, available: number): number => {
  const startEdge = start < available ? (available + start) / 2 : start
  const targetEdge = startEdge + pointerDelta
  return targetEdge <= available ? targetEdge * 2 - available : targetEdge
}

const resizeFromStartRail = (start: number, pointerDelta: number, available: number): number => {
  if (start > available) {
    const distanceToFit = start - available
    return pointerDelta <= distanceToFit
      ? start - pointerDelta
      : available - (pointerDelta - distanceToFit) * 2
  }
  const targetEdge = (available - start) / 2 + pointerDelta
  return targetEdge >= 0 ? available - targetEdge * 2 : available - targetEdge
}

/**
 * Map a rail pointer delta onto a new freeform size, keeping the grabbed edge under the pointer.
 * @param start - size at pointer-down.
 * @param pointerDelta - pointer movement in host pixels.
 * @param available - device-mode area (toolbar and rails already subtracted).
 * @param zoomFactor - live page zoom, default 1.
 * @param direction - which rail was grabbed, default southeast.
 * @param aspectRatio - locked width/height ratio, or omitted.
 * @returns a clamped freeform size.
 */
export function resizeBrowserViewportFromRail(
  start: PreviewViewportSize,
  pointerDelta: { readonly x: number; readonly y: number },
  available: PreviewViewportSize,
  zoomFactor = 1,
  direction: BrowserViewportResizeDirection = 'southeast',
  aspectRatio?: number,
): PreviewViewportSize {
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor)
  const startWidth = start.width * normalizedZoomFactor
  const startHeight = start.height * normalizedZoomFactor
  const desiredWidth = direction.includes('east')
    ? resizeFromEndRail(startWidth, pointerDelta.x, available.width)
    : direction.includes('west')
      ? resizeFromStartRail(startWidth, pointerDelta.x, available.width)
      : startWidth
  const desiredHeight = direction.includes('south')
    ? resizeFromEndRail(startHeight, pointerDelta.y, available.height)
    : direction.includes('north')
      ? resizeFromStartRail(startHeight, pointerDelta.y, available.height)
      : startHeight
  const widthDelta = desiredWidth - startWidth
  const heightDelta = desiredHeight - startHeight
  return resizeFreeformViewport(
    start,
    {
      x: direction.includes('west') ? -widthDelta : widthDelta,
      y: direction.includes('north') ? -heightDelta : heightDelta,
    },
    normalizedZoomFactor,
    direction,
    aspectRatio,
  )
}

/**
 * Freeform size that fills the device-mode area at the current zoom.
 * @param container - full host width and height.
 * @param zoomFactor - live page zoom, default 1.
 * @returns a clamped freeform size.
 */
export function resolveResponsiveBrowserViewportSize(
  container: { readonly width: number; readonly height: number },
  zoomFactor = 1,
): PreviewViewportSize {
  const area = resolveBrowserDeviceViewportArea(container)
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor)
  return resizeFreeformViewport(
    {
      width: area.width / normalizedZoomFactor,
      height: area.height / normalizedZoomFactor,
    },
    { x: 0, y: 0 },
  )
}
