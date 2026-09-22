// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readPreviewAnnotationTheme } from '../src/client/annotationTheme.ts'

const leftoverCss = `--${['t', '3'].join('')}-`
const leftoverBrand = ['t', '3', 'code'].join('')

describe('readPreviewAnnotationTheme', () => {
  it('maps --dsw-alias tokens onto theme fields and never emits leftover CSS names', () => {
    document.documentElement.removeAttribute('data-ds-dark-theme')
    document.documentElement.style.setProperty('--dsw-alias-button-primary-fill', 'rgb(9, 9, 9)')
    document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', 'rgb(255, 255, 255)')
    document.documentElement.style.setProperty('--dsw-alias-label-primary', 'rgb(15, 17, 21)')
    const theme = readPreviewAnnotationTheme()
    expect(theme.primary).toBe('rgb(9, 9, 9)')
    expect(theme.background).toBe('rgb(255, 255, 255)')
    expect(theme.colorScheme).toBe('light')
    expect(JSON.stringify(theme)).not.toMatch(new RegExp(leftoverCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(JSON.stringify(theme)).not.toMatch(new RegExp(leftoverBrand))
  })

  it('falls back to a default theme when computed alias values are empty', () => {
    document.documentElement.style.cssText = ''
    const theme = readPreviewAnnotationTheme()
    expect(theme.primary.length).toBeGreaterThan(0)
    expect(theme.primary).not.toContain(leftoverCss.slice(0, -1))
    expect(theme.background.length).toBeGreaterThan(0)
  })

  it('reads dark colorScheme from data-ds-dark-theme', () => {
    document.documentElement.setAttribute('data-ds-dark-theme', '')
    const theme = readPreviewAnnotationTheme()
    expect(theme.colorScheme).toBe('dark')
    document.documentElement.removeAttribute('data-ds-dark-theme')
  })

  it('reads dark colorScheme from computed color-scheme when the dark attr is absent', () => {
    document.documentElement.removeAttribute('data-ds-dark-theme')
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const styles = real(element)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'colorScheme') return 'dark'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    expect(readPreviewAnnotationTheme().colorScheme).toBe('dark')
    vi.restoreAllMocks()
  })

  it('falls back to the default fontSans when font-family is empty', () => {
    document.documentElement.style.cssText = ''
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const styles = real(element)
      return new Proxy(styles, {
        get(target, prop, receiver) {
          if (prop === 'fontFamily') return ''
          if (prop === 'getPropertyValue') {
            return (name: string) => target.getPropertyValue(name)
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    expect(readPreviewAnnotationTheme().fontSans).toBe('system-ui, sans-serif')
    vi.restoreAllMocks()
  })
})
