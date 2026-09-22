/** Device toolbar and 10px resize rails inside the preview host. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { Button, Input, Menu, Switch, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PreviewKey } from './locales.ts'
import {
  BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  resizeBrowserViewportFromRail,
  resizeFreeformViewport,
  resolveBrowserDeviceViewportArea,
  type BrowserViewportLayout,
  type BrowserViewportResizeDirection,
  type PreviewViewportSetting,
} from './viewport.ts'
import { PREVIEW_VIEWPORT_PRESETS } from './viewportPresets.ts'
import css from './PreviewPanel.module.css'

const RESPONSIVE_ID = 'responsive'
const RAIL_DIRECTIONS: readonly {
  readonly direction: BrowserViewportResizeDirection
  readonly labelKey: PreviewKey
  readonly className: string | undefined
}[] = [
  { direction: 'west', labelKey: 'viewportRailWest', className: css.railWest },
  { direction: 'east', labelKey: 'viewportRailEast', className: css.railEast },
  { direction: 'south', labelKey: 'viewportRailSouth', className: css.railSouth },
  { direction: 'southwest', labelKey: 'viewportRailSouthwest', className: css.railSouthwest },
  { direction: 'southeast', labelKey: 'viewportRailSoutheast', className: css.railSoutheast },
]

export interface DeviceToolbarProps {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: 'fill' }>
  readonly layout: BrowserViewportLayout
  readonly zoomFactor: number
  readonly aspectRatio: number | null
  readonly t: (key: PreviewKey) => string
  readonly onAspectRatioChange: (aspectRatio: number | null) => void
  readonly onChange: (setting: PreviewViewportSetting) => void
  /** Fired when the portaled preset catalog opens or closes so the panel can `previewHide`. */
  readonly onPresetOpenChange?: (open: boolean) => void
}

function presetLabel(presetId: string, width: number, height: number): string {
  const preset = PREVIEW_VIEWPORT_PRESETS.find(candidate => candidate.id === presetId)
  return preset !== undefined ? preset.label : `${width} × ${height}`
}

function dimensionValid(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width >= PREVIEW_VIEWPORT_MIN_DIMENSION
    && width <= PREVIEW_VIEWPORT_MAX_DIMENSION
    && height >= PREVIEW_VIEWPORT_MIN_DIMENSION
    && height <= PREVIEW_VIEWPORT_MAX_DIMENSION
    && width * height <= PREVIEW_VIEWPORT_MAX_AREA
}

/**
 * Width × height fields, Chrome device preset menu, rotate, aspect lock, and resize rails.
 * @param props - live setting, layout for rails, zoom, copy, and commit callbacks.
 * @returns toolbar row plus rail buttons positioned on the host.
 */
export function DeviceToolbar({
  setting,
  layout,
  zoomFactor,
  aspectRatio,
  t,
  onAspectRatioChange,
  onChange,
  onPresetOpenChange,
}: DeviceToolbarProps): ReactElement {
  const [presetOpen, setPresetOpen] = useState(false)
  const [customSize, setCustomSize] = useState<{ readonly width: string; readonly height: string } | null>(null)
  const setMenuOpen = (open: boolean): void => {
    setPresetOpen(open)
    onPresetOpenChange?.(open)
  }
  useEffect(() => () => { onPresetOpenChange?.(false) }, [onPresetOpenChange])
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const presented = customSize ?? { width: String(setting.width), height: String(setting.height) }
  const customWidth = Number(presented.width)
  const customHeight = Number(presented.height)
  const customValid = dimensionValid(customWidth, customHeight)
  const selectedPresetId =
    setting._tag === 'preset' && PREVIEW_VIEWPORT_PRESETS.some(preset => preset.id === setting.presetId)
      ? setting.presetId
      : RESPONSIVE_ID
  const items: MenuEntry[] = [
    { id: RESPONSIVE_ID, label: t('viewportResponsive') },
    { type: 'separator', id: 'preset-sep' },
    ...PREVIEW_VIEWPORT_PRESETS.map(preset => ({
      id: preset.id,
      label: `${preset.label} ${preset.detail}`,
    })),
  ]

  useEffect(() => () => {
    dragCleanupRef.current?.()
  }, [])

  const applyCustomSize = (): void => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null)
      return
    }
    onChange({ _tag: 'freeform', width: customWidth, height: customHeight })
    setCustomSize(null)
  }

  const updateCustomDimension = (axis: 'width' | 'height', value: string): void => {
    setCustomSize(current => {
      const base = current === null
        ? { width: String(setting.width), height: String(setting.height) }
        : current
      const next = {
        width: axis === 'width' ? value : base.width,
        height: axis === 'height' ? value : base.height,
      }
      const numeric = Number(value)
      if (
        aspectRatio === null
        || !Number.isInteger(numeric)
        || numeric < PREVIEW_VIEWPORT_MIN_DIMENSION
        || numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
      ) {
        return next
      }
      const resized = resizeFreeformViewport(
        setting,
        axis === 'width'
          ? { x: numeric - setting.width, y: 0 }
          : { x: 0, y: numeric - setting.height },
        1,
        axis === 'width' ? 'east' : 'south',
        aspectRatio,
      )
      return { width: String(resized.width), height: String(resized.height) }
    })
  }

  const onPresetSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === RESPONSIVE_ID) {
      if (setting._tag === 'freeform') return
      onChange({ _tag: 'freeform', width: setting.width, height: setting.height })
      return
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find(candidate => candidate.id === id)
    /* v8 ignore next -- Menu only emits catalog ids and Responsive. */
    if (preset === undefined) return
    onChange({
      _tag: 'preset',
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
    })
    if (aspectRatio !== null) onAspectRatioChange(preset.width / preset.height)
  }

  const rotate = (): void => {
    const hasCustom =
      customValid && (customWidth !== setting.width || customHeight !== setting.height)
    const source = hasCustom
      ? { _tag: 'freeform' as const, width: customWidth, height: customHeight }
      : setting
    onChange({ ...source, width: source.height, height: source.width })
    if (aspectRatio !== null) onAspectRatioChange(1 / aspectRatio)
    setCustomSize(null)
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    applyCustomSize()
  }

  const onRailPointerDown = (
    direction: BrowserViewportResizeDirection,
    event: PointerEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    dragCleanupRef.current?.()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = setting.width
    const startHeight = setting.height
    const available = resolveBrowserDeviceViewportArea({
      width: layout.canvasWidth,
      height: layout.canvasHeight,
    })
    const dragZoomFactor = (Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1) * layout.viewportScale
    let latest = { width: startWidth, height: startHeight }
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // jsdom and some browsers omit pointer capture; window listeners still drag.
    }
    const move = (moveEvent: globalThis.PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      latest = resizeBrowserViewportFromRail(
        { width: startWidth, height: startHeight },
        { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY },
        available,
        dragZoomFactor,
        direction,
        aspectRatio ?? undefined,
      )
      onChange({ _tag: 'freeform', width: latest.width, height: latest.height })
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      dragCleanupRef.current = null
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        // Capture may already be released on pointerup.
      }
    }
    const finish = (upEvent: globalThis.PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
      if (latest.width === startWidth && latest.height === startHeight) return
      onChange({ _tag: 'freeform', width: latest.width, height: latest.height })
    }
    const cancel = (cancelEvent: globalThis.PointerEvent): void => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      onChange(setting)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const onRailKeyDown = (
    direction: BrowserViewportResizeDirection,
    event: KeyboardEvent<HTMLButtonElement>,
  ): void => {
    const controlsWidth = direction.includes('east') || direction.includes('west')
    const controlsHeight = direction.includes('north') || direction.includes('south')
    const normalizedZoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
    const step = (event.shiftKey ? 50 : 10) * normalizedZoom
    const delta =
      event.key === 'ArrowLeft' && controlsWidth
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight' && controlsWidth
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp' && controlsHeight
            ? { x: 0, y: -step }
            : event.key === 'ArrowDown' && controlsHeight
              ? { x: 0, y: step }
              : null
    if (delta === null) return
    event.preventDefault()
    const next = resizeFreeformViewport(
      setting,
      delta,
      zoomFactor,
      direction,
      aspectRatio ?? undefined,
    )
    if (next.width === setting.width && next.height === setting.height) return
    onChange({ _tag: 'freeform', width: next.width, height: next.height })
  }

  const left = layout.viewportX
  const top = layout.viewportY
  const right = left + layout.viewportWidth
  const bottom = top + layout.viewportHeight
  const rail = BROWSER_VIEWPORT_RESIZE_RAIL_SIZE
  const railStyle = (direction: BrowserViewportResizeDirection): { left: number; top: number; width: number; height: number } => {
    if (direction === 'west') return { left: left - rail, top, width: rail, height: layout.viewportHeight }
    if (direction === 'east') return { left: right, top, width: rail, height: layout.viewportHeight }
    if (direction === 'south') return { left, top: bottom, width: layout.viewportWidth, height: rail }
    if (direction === 'southwest') return { left: left - rail, top: bottom, width: rail, height: rail }
    return { left: right, top: bottom, width: rail, height: rail }
  }

  return (
    <>
      <div
        className={css.deviceToolbar}
        style={{ height: 32 }}
        role="toolbar"
        aria-label={t('deviceToolbarAria')}
        data-browser-device-toolbar
      >
        <Menu
          compact
          portal
          open={presetOpen}
          items={items}
          selectedId={selectedPresetId}
          onSelect={onPresetSelect}
          onClose={() => { setMenuOpen(false) }}
          anchor={(
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewportPreset')}
              aria-expanded={presetOpen}
              data-preset-id={selectedPresetId}
              onClick={() => { setMenuOpen(!presetOpen) }}
            >
              {setting._tag === 'preset'
                ? presetLabel(setting.presetId, setting.width, setting.height)
                : t('viewportResponsive')}
            </Button>
          )}
        />
        <form className={css.deviceDims} aria-label={t('viewportDimensions')} onSubmit={onSubmit}>
          <Input
            className={css.deviceDim}
            type="number"
            inputMode="numeric"
            min={PREVIEW_VIEWPORT_MIN_DIMENSION}
            max={PREVIEW_VIEWPORT_MAX_DIMENSION}
            value={presented.width}
            aria-label={t('viewportWidth')}
            aria-invalid={!customValid}
            onFocus={() => {
              setCustomSize(current => current ?? {
                width: String(setting.width),
                height: String(setting.height),
              })
            }}
            onChange={event => { updateCustomDimension('width', event.target.value) }}
            onBlur={applyCustomSize}
          />
          <span className={css.deviceTimes} aria-hidden="true">×</span>
          <Input
            className={css.deviceDim}
            type="number"
            inputMode="numeric"
            min={PREVIEW_VIEWPORT_MIN_DIMENSION}
            max={PREVIEW_VIEWPORT_MAX_DIMENSION}
            value={presented.height}
            aria-label={t('viewportHeight')}
            aria-invalid={!customValid}
            onFocus={() => {
              setCustomSize(current => current ?? {
                width: String(setting.width),
                height: String(setting.height),
              })
            }}
            onChange={event => { updateCustomDimension('height', event.target.value) }}
            onBlur={applyCustomSize}
          />
        </form>
        <Switch
          checked={aspectRatio !== null}
          aria-label={aspectRatio === null ? t('viewportLock') : t('viewportUnlock')}
          disabled={!customValid}
          onChange={() => {
            onAspectRatioChange(aspectRatio === null ? customWidth / customHeight : null)
          }}
        />
        <Button variant="ghost" size="sm" type="button" aria-label={t('viewportRotate')} onClick={rotate}>
          {t('viewportRotate')}
        </Button>
      </div>
      {RAIL_DIRECTIONS.map(entry => (
        <button
          key={entry.direction}
          type="button"
          className={`${css.rail} ${entry.className}`}
          style={railStyle(entry.direction)}
          aria-label={t(entry.labelKey)}
          data-browser-viewport-rail={entry.direction}
          onPointerDown={event => { onRailPointerDown(entry.direction, event) }}
          onKeyDown={event => { onRailKeyDown(entry.direction, event) }}
        />
      ))}
    </>
  )
}
