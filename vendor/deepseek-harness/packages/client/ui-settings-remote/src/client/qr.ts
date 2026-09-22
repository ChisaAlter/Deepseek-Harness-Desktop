import { encode } from 'uqr'

function cellOn(row: unknown, x: number): boolean {
  /* v8 ignore next -- uqr emits a row array per module line */
  return Array.isArray(row) ? Boolean(row[x]) : false
}

/**
 * Encode `text` as an SVG QR using the maintained `uqr` encoder.
 * @param text - pairing URL, including the `#offer=` fragment.
 * @returns an SVG string, or empty when `text` is empty.
 */
export function qrSvg(text: string): string {
  if (!text) return ''
  const qr = encode(text)
  const size = qr.size
  const rows = qr.data as unknown
  /* v8 ignore next -- uqr version 1 is 21 modules; a non-array payload cannot be drawn */
  if (!Array.isArray(rows) || size < 21) return ''
  const parts: string[] = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cellOn(rows[y], x)) parts.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${parts.join('')}"/></svg>`
}
