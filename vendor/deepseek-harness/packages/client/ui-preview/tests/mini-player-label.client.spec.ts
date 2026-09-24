import { describe, expect, it } from 'vitest'
import { miniPlayerLabelFromUrl } from '../src/client/mini-player-label.ts'

describe('mini-player label', () => {
  it('uses the delivered filename from a token URL', () => {
    expect(miniPlayerLabelFromUrl('http://127.0.0.1:52464/token/site/pelican-bike.html')).toBe('pelican-bike.html')
    expect(miniPlayerLabelFromUrl('http://127.0.0.1:52464/token/site/%E9%A2%84%E8%A7%88.pdf')).toBe('预览.pdf')
  })

  it('uses the host for an ordinary site', () => {
    expect(miniPlayerLabelFromUrl('http://localhost:3000/docs')).toBe('localhost')
  })
})
