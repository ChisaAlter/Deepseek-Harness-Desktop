import { describe, expect, it } from 'vitest'
import { formatPickedAnnotationMarkdown } from '../src/client/pickMarkdown.ts'

const screenshot = { dataUrl: 'data:image/png;base64,abc' }

describe('formatPickedAnnotationMarkdown', () => {
  it('includes comment, image alt from selector, and a backtick selector line', () => {
    expect(formatPickedAnnotationMarkdown({
      annotation: {
        comment: 'nudge the button',
        elements: [{ element: { selector: '#save' } }],
      },
      screenshot,
    })).toBe('nudge the button\n![#save](data:image/png;base64,abc)\n`#save`')
  })

  it('uses element as the image alt when the selector is empty', () => {
    expect(formatPickedAnnotationMarkdown({
      annotation: { comment: '', elements: [{ element: { selector: '' } }] },
      screenshot,
    })).toBe('![element](data:image/png;base64,abc)')
  })

  it('omits the image line when no data URL is present', () => {
    expect(formatPickedAnnotationMarkdown({
      annotation: { comment: '', elements: [{ element: { selector: '#save' } }] },
    })).toBe('`#save`')
  })

  it('returns an empty string when there is no comment, selector, or screenshot', () => {
    expect(formatPickedAnnotationMarkdown({})).toBe('')
  })
})
