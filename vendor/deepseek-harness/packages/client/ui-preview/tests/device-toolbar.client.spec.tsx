// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DeviceToolbar } from '../src/client/DeviceToolbar.tsx'
import { en } from '../src/client/locales.ts'
import {
  resolveBrowserDeviceViewportLayout,
  type PreviewViewportSetting,
} from '../src/client/viewport.ts'

const t = (key: keyof typeof en): string => en[key]
const iphoneSe = {
  _tag: 'preset' as const,
  presetId: 'iphone-se',
  width: 375,
  height: 667,
}
const layout = resolveBrowserDeviceViewportLayout(
  { width: 800, height: 600 },
  iphoneSe,
)

afterEach(cleanup)

function mountToolbar(
  setting: Exclude<PreviewViewportSetting, { readonly _tag: 'fill' }> = iphoneSe,
  opts: { aspectRatio?: number | null; zoomFactor?: number } = {},
) {
  const onChange = vi.fn()
  const onAspectRatioChange = vi.fn()
  render(
    <DeviceToolbar
      setting={setting}
      layout={layout}
      zoomFactor={opts.zoomFactor ?? 1}
      aspectRatio={opts.aspectRatio ?? null}
      t={t}
      onAspectRatioChange={onAspectRatioChange}
      onChange={onChange}
    />,
  )
  return { onChange, onAspectRatioChange }
}

describe('DeviceToolbar', () => {
  it('rotates the current preset by swapping width and height', () => {
    const { onChange, onAspectRatioChange } = mountToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }))
    expect(onChange).toHaveBeenCalledWith({
      _tag: 'preset',
      presetId: 'iphone-se',
      width: 667,
      height: 375,
    })
    expect(onAspectRatioChange).not.toHaveBeenCalled()
  })

  it('inverts a locked aspect ratio when rotating', () => {
    const { onAspectRatioChange } = mountToolbar(iphoneSe, { aspectRatio: 375 / 667 })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }))
    expect(onAspectRatioChange).toHaveBeenCalledWith(667 / 375)
  })

  it('commits a catalog preset from the menu', () => {
    const { onChange, onAspectRatioChange } = mountToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'iPhone XR 414 × 896' }))
    expect(onChange).toHaveBeenCalledWith({
      _tag: 'preset',
      presetId: 'iphone-xr',
      width: 414,
      height: 896,
    })
    expect(onAspectRatioChange).not.toHaveBeenCalled()
  })

  it('updates the locked ratio when picking a preset while locked', () => {
    const { onAspectRatioChange } = mountToolbar(iphoneSe, { aspectRatio: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'iPhone XR 414 × 896' }))
    expect(onAspectRatioChange).toHaveBeenCalledWith(414 / 896)
  })

  it('converts a preset to freeform Responsive and ignores a second Responsive pick', () => {
    const first = mountToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Responsive' }))
    expect(first.onChange).toHaveBeenCalledWith({
      _tag: 'freeform',
      width: 375,
      height: 667,
    })
    cleanup()
    const second = mountToolbar({ _tag: 'freeform', width: 375, height: 667 })
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Responsive' }))
    expect(second.onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Device preset' }).textContent).toBe('Responsive')
  })

  it('shows width × height for an unknown preset id', () => {
    mountToolbar({ _tag: 'preset', presetId: 'not-a-device', width: 400, height: 500 })
    expect(screen.getByText('400 × 500')).toBeTruthy()
  })

  it('commits a typed custom size on blur and ignores an unchanged blur', () => {
    const { onChange } = mountToolbar()
    const width = screen.getByRole('spinbutton', { name: 'Viewport width' }) as HTMLInputElement
    fireEvent.focus(width)
    fireEvent.blur(width)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '400' } })
    fireEvent.blur(width)
    expect(onChange).toHaveBeenCalledWith({ _tag: 'freeform', width: 400, height: 667 })
  })

  it('submits a custom size from the dimensions form', () => {
    const { onChange } = mountToolbar()
    const height = screen.getByRole('spinbutton', { name: 'Viewport height' }) as HTMLInputElement
    fireEvent.focus(height)
    fireEvent.change(height, { target: { value: '800' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Viewport dimensions' }))
    expect(onChange).toHaveBeenCalledWith({ _tag: 'freeform', width: 375, height: 800 })
  })

  it('discards an invalid typed size', () => {
    const { onChange } = mountToolbar()
    const width = screen.getByRole('spinbutton', { name: 'Viewport width' })
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '10' } })
    fireEvent.blur(width)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a locked pair in sync while typing a valid width', () => {
    mountToolbar(iphoneSe, { aspectRatio: 375 / 667 })
    const width = screen.getByRole('spinbutton', { name: 'Viewport width' }) as HTMLInputElement
    const height = screen.getByRole('spinbutton', { name: 'Viewport height' }) as HTMLInputElement
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '750' } })
    fireEvent.change(height, { target: { value: '800' } })
    expect(Number(width.value)).toBeGreaterThan(0)
    expect(Number(height.value)).toBeGreaterThan(0)
  })

  it('does not lock-follow a non-integer typed value', () => {
    mountToolbar(iphoneSe, { aspectRatio: 1 })
    const width = screen.getByRole('spinbutton', { name: 'Viewport width' }) as HTMLInputElement
    fireEvent.change(width, { target: { value: '12.5' } })
    expect(width.value).toBe('12.5')
    fireEvent.change(width, { target: { value: '100' } })
    expect(width.value).toBe('100')
    fireEvent.change(width, { target: { value: '9000' } })
    expect(width.value).toBe('9000')
    const height = screen.getByRole('spinbutton', { name: 'Viewport height' }) as HTMLInputElement
    fireEvent.change(height, { target: { value: '900' } })
    expect(height.value).toBe('900')
  })

  it('toggles aspect lock from the switch', () => {
    const unlocked = mountToolbar()
    fireEvent.click(screen.getByRole('switch', { name: 'Lock aspect ratio' }))
    expect(unlocked.onAspectRatioChange).toHaveBeenCalledWith(375 / 667)
    cleanup()
    const locked = mountToolbar(iphoneSe, { aspectRatio: 1 })
    fireEvent.click(screen.getByRole('switch', { name: 'Unlock aspect ratio' }))
    expect(locked.onAspectRatioChange).toHaveBeenCalledWith(null)
  })

  it('rotates a pending custom size instead of the committed setting', () => {
    const { onChange } = mountToolbar()
    const width = screen.getByRole('spinbutton', { name: 'Viewport width' })
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }))
    expect(onChange).toHaveBeenCalledWith({
      _tag: 'freeform',
      width: 667,
      height: 400,
    })
  })

  it('drags the east rail and commits a freeform size', () => {
    const { onChange } = mountToolbar()
    const rail = screen.getByRole('button', { name: 'Resize viewport from the right edge' })
    fireEvent.pointerDown(rail, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 520, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 520, clientY: 300 })
    expect(onChange.mock.calls.length).toBeGreaterThan(0)
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as PreviewViewportSetting
    expect(last._tag).toBe('freeform')
  })

  it('ignores pointer events from a different pointer and no-ops a zero-length drag', () => {
    const { onChange } = mountToolbar()
    const rail = screen.getByRole('button', { name: 'Resize viewport from the right edge' })
    fireEvent.pointerDown(rail, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 800, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 800, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores the start size when a drag is cancelled', () => {
    const { onChange } = mountToolbar()
    const rail = screen.getByRole('button', { name: 'Resize viewport from the right edge' })
    fireEvent.pointerDown(rail, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 520, clientY: 300 })
    fireEvent.pointerCancel(window, { pointerId: 1, clientX: 520, clientY: 300 })
    expect(onChange).toHaveBeenCalledWith(iphoneSe)
  })

  it('resizes from the east rail with arrow keys and ignores unrelated keys', () => {
    const { onChange } = mountToolbar()
    const rail = screen.getByRole('button', { name: 'Resize viewport from the right edge' })
    fireEvent.keyDown(rail, { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(rail, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith({ _tag: 'freeform', width: 385, height: 667 })
    fireEvent.keyDown(rail, { key: 'ArrowLeft', shiftKey: true })
  })

  it('resizes north and west rails from the keyboard', () => {
    const { onChange } = mountToolbar()
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize viewport from the left edge' }),
      { key: 'ArrowLeft' },
    )
    expect(onChange).toHaveBeenCalledWith({ _tag: 'freeform', width: 385, height: 667 })
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize viewport from the bottom edge' }),
      { key: 'ArrowDown' },
    )
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize viewport from the bottom-left corner' }),
      { key: 'ArrowUp' },
    )
  })

  it('treats a non-positive zoom factor as 1 during rail drags', () => {
    const { onChange } = mountToolbar(iphoneSe, { zoomFactor: 0 })
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Resize viewport from the right edge' }),
      { pointerId: 1, clientX: 400, clientY: 300 },
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 430, clientY: 300 })
    expect(onChange.mock.calls.length).toBeGreaterThan(0)
    fireEvent.pointerCancel(window, { pointerId: 2, clientX: 430, clientY: 300 })
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize viewport from the right edge' }),
      { key: 'ArrowRight' },
    )
  })

  it('does not emit a keyboard resize that stays at the minimum size', () => {
    const { onChange } = mountToolbar({ _tag: 'freeform', width: 240, height: 240 })
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize viewport from the right edge' }),
      { key: 'ArrowLeft' },
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes the preset menu on Escape', () => {
    mountToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
