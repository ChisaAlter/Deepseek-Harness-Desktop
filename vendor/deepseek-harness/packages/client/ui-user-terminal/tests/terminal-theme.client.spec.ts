// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_TERMINAL_FONT_FAMILY,
  readXtermFont,
  terminalFontOptions,
  terminalThemeFromApp,
} from '../src/client/terminal-theme.ts'

function mockCanvasFromFillStyle(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mock(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== '2d') return null
    const ctx = { fillStyle: '' }
    return {
      clearRect() {},
      get fillStyle() { return ctx.fillStyle },
      set fillStyle(value: string) { ctx.fillStyle = String(value) },
      fillRect() {},
      getImageData() {
        const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(ctx.fillStyle)
        if (rgb === null) return { data: Uint8ClampedArray.from([0, 0, 0, 0]) }
        return {
          data: Uint8ClampedArray.from([
            Math.round(Number(rgb[1])),
            Math.round(Number(rgb[2])),
            Math.round(Number(rgb[3])),
            255,
          ]),
        }
      },
    } as unknown as CanvasRenderingContext2D
  })
}

function drawerHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.className = 'thread-terminal-drawer'
  document.body.appendChild(host)
  return host
}

describe('terminalThemeFromApp', () => {
  it('reads the pane background and color as Ghostty RGB, not an ANSI table', () => {
    mockCanvasFromFillStyle()
    const host = drawerHost()
    host.style.backgroundColor = 'rgb(10, 20, 30)'
    host.style.color = 'rgb(200, 210, 220)'
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 10, g: 20, b: 30 })
    expect(theme.backgroundOpacity).toBe(1)
    expect(theme.foreground).toEqual({ r: 200, g: 210, b: 220 })
    expect(theme.cursor).toEqual({ r: 38, g: 56, b: 78 })
    expect(theme.selectionBackground).toBe('rgba(37, 63, 99, 0.2)')
    host.remove()
    vi.restoreAllMocks()
  })

  it('reports the pane fill alpha as backgroundOpacity when the pane is translucent', () => {
    const host = drawerHost()
    host.style.backgroundColor = 'rgba(10, 20, 30, 0.75)'
    host.style.color = 'rgb(200, 210, 220)'
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mock(
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== '2d') return null
      return {
        clearRect() {},
        fillRect() {},
        getImageData() {
          return { data: Uint8ClampedArray.from([10, 20, 30, 191]) }
        },
      } as unknown as CanvasRenderingContext2D
    })
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 10, g: 20, b: 30 })
    expect(theme.backgroundOpacity).toBeCloseTo(191 / 255)
    vi.restoreAllMocks()
    host.remove()
  })

  it('falls back when the canvas leaves the sentinel pixel standing', () => {
    const host = drawerHost()
    const realStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = realStyle(el)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'backgroundColor') return 'bogus-fn(1 2 3)'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    // An unpaintable fillStyle leaves the sentinel pixel from the probe.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect() {},
      fillRect() {},
      getImageData() {
        return { data: Uint8ClampedArray.from([7, 8, 9, 255]) }
      },
    } as unknown as CanvasRenderingContext2D)
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 255, g: 255, b: 255 })
    expect(theme.backgroundOpacity).toBe(1)
    vi.restoreAllMocks()
    host.remove()
  })

  it('uses the dark Ghostty cursor and selection overlay when the desktop dark attribute is set', () => {
    mockCanvasFromFillStyle()
    document.body.setAttribute('data-ds-dark-theme', '')
    const host = drawerHost()
    host.style.backgroundColor = 'rgb(21, 21, 23)'
    host.style.color = 'rgb(249, 250, 251)'
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 21, g: 21, b: 23 })
    expect(theme.cursor).toEqual({ r: 180, g: 203, b: 255 })
    expect(theme.selectionBackground).toBe('rgba(180, 203, 255, 0.25)')
    host.remove()
    document.body.removeAttribute('data-ds-dark-theme')
    vi.restoreAllMocks()
  })

  it('falls back when the host has no computed colors', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const real = window.getComputedStyle.bind(window)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = real(el)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'backgroundColor' || prop === 'color') return 'transparent'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 255, g: 255, b: 255 })
    expect(theme.foreground).toEqual({ r: 28, g: 33, b: 41 })
    spy.mockRestore()
    host.remove()
  })

  it('does not map ANSI onto UI state tokens; Ghostty keeps the engine palette', () => {
    const host = document.createElement('div')
    host.style.backgroundColor = 'rgb(21, 21, 23)'
    host.style.setProperty('--dsw-alias-state-success-secondary', 'rgb(78, 209, 126)')
    document.body.appendChild(host)
    const theme = terminalThemeFromApp(host)
    expect(theme).not.toHaveProperty('cyan')
    expect(theme).not.toHaveProperty('blue')
    host.remove()
  })

  it('uses the canvas 1x1 path when the color is not an rgb() string', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const realStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = realStyle(el)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'backgroundColor') return 'oklch(0.4 0.1 250)'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    const real = HTMLCanvasElement.prototype.getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mock(
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== '2d') return real.call(this, type)
      return {
        clearRect() {},
        fillRect() {},
        getImageData() {
          return { data: Uint8ClampedArray.from([17, 34, 51, 255]) }
        },
      } as unknown as CanvasRenderingContext2D
    })
    const theme = terminalThemeFromApp(host)
    expect(theme.background).toEqual({ r: 17, g: 34, b: 51 })
    vi.restoreAllMocks()
    host.remove()
  })

  it('falls back when the canvas cannot paint the color', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const realStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = realStyle(el)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'backgroundColor') return 'oklch(0.2 0.1 40)'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(terminalThemeFromApp(host).background).toEqual({ r: 255, g: 255, b: 255 })
    vi.restoreAllMocks()
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = realStyle(el)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'backgroundColor') return 'oklch(0.2 0.1 40)'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect() {},
      fillRect() {},
      getImageData() {
        return { data: Uint8ClampedArray.from([1, 2, 3, 0]) }
      },
    } as unknown as CanvasRenderingContext2D)
    expect(terminalThemeFromApp(host).background).toEqual({ r: 255, g: 255, b: 255 })
    vi.restoreAllMocks()
    host.remove()
  })

  it('treats the html.dark class as dark like Ghostty', () => {
    document.documentElement.classList.add('dark')
    const host = document.createElement('div')
    host.style.backgroundColor = 'rgb(21, 21, 23)'
    document.body.appendChild(host)
    const theme = terminalThemeFromApp(host)
    expect(theme.cursor).toEqual({ r: 180, g: 203, b: 255 })
    host.remove()
    document.documentElement.classList.remove('dark')
  })

  it('reads body when the host is omitted, matching Ghostty', () => {
    const theme = terminalThemeFromApp()
    expect(theme.cursor).toEqual({ r: 38, g: 56, b: 78 })
    expect(terminalThemeFromApp(null).cursor).toEqual({ r: 38, g: 56, b: 78 })
  })
})

describe('readXtermFont', () => {
  it('falls back to a monospace stack when CSS families do not resolve', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const font = readXtermFont(host)
    expect(font.fontFamily.includes('var(')).toBe(false)
    expect(font.fontFamily).toBe(FALLBACK_TERMINAL_FONT_FAMILY)
    expect(font.fontSize).toBe(12)
    host.remove()
  })

  it('uses the probe computed family when it is a concrete stack', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const real = window.getComputedStyle.bind(window)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const styles = real(el)
      if (el instanceof HTMLSpanElement && el.style.fontFamily.includes('--dsw-font-family-terminal')) {
        return new Proxy(styles, {
          get(target, prop, receiver) {
            if (prop === 'fontFamily') return '"SF Mono"'
            return Reflect.get(target, prop, receiver)
          },
        })
      }
      return styles
    })
    const font = readXtermFont(host)
    expect(font.fontFamily).toBe('"SF Mono"')
    spy.mockRestore()
    host.remove()
  })

  it('reads --dsw-font-family-terminal and --dsw-font-size-code from the host', () => {
    const host = document.createElement('div')
    host.style.setProperty('--dsw-font-family-terminal', '"IBM Plex Mono"')
    host.style.setProperty('--dsw-font-size-code', '14px')
    document.body.appendChild(host)
    const font = readXtermFont(host)
    expect(font.fontFamily).toContain('IBM Plex Mono')
    expect(font.fontFamily.includes('var(')).toBe(false)
    expect(font.fontSize).toBe(14)
    host.remove()
  })

  it('falls back from --dsw-font-family-terminal to --ds-font-family-code', () => {
    const host = document.createElement('div')
    host.style.setProperty('--dsw-font-family-terminal', 'var(--missing)')
    host.style.setProperty('--ds-font-family-code', '"JetBrains Mono"')
    document.body.appendChild(host)
    const font = readXtermFont(host)
    expect(font.fontFamily).toContain('JetBrains Mono')
    host.remove()
  })

  it('ignores a non-positive --dsw-font-size-code', () => {
    const host = document.createElement('div')
    host.style.setProperty('--dsw-font-size-code', '0px')
    document.body.appendChild(host)
    expect(readXtermFont(host).fontSize).toBe(12)
    host.style.setProperty('--dsw-font-size-code', 'nope')
    expect(readXtermFont(host).fontSize).toBe(12)
    host.remove()
  })

  it('omits family when terminalFontOptions sees an empty stack', () => {
    expect(terminalFontOptions('  ', 12)).toEqual({ size: 12 })
    expect(terminalFontOptions('JetBrains Mono', 14)).toEqual({ family: 'JetBrains Mono', size: 14 })
  })
})
