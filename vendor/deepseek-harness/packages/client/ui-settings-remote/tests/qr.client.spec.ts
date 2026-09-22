import { describe, expect, it } from 'vitest'
import { qrSvg } from '../src/client/qr.ts'

describe('qrSvg', () => {
  it('returns empty SVG markup for an empty payload', () => {
    expect(qrSvg('')).toBe('')
  })

  it('emits an SVG QR for a pairing URL', () => {
    const svg = qrSvg('http://10.0.0.4:3180/#offer=abc')
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('viewBox="0 0 ')
    expect(svg).toContain('M1 1h1v1h-1z')
  })
})
