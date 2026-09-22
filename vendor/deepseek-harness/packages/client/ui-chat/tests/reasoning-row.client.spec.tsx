// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it.each([
    { kind: 'text' as const, text: 'Answer' },
    { kind: 'tool-call' as const, callId: 'call-1', name: 'read', argsRaw: '{}' },
  ])('starts collapsed and preserves manual expansion when $kind arrives', (nextBlock) => {
    const reasoning = { kind: 'reasoning' as const, text: 'Inspect the session\nCheck persistence' }
    const view = render(
      <AssistantMarkdown t={t} blocks={[reasoning]} streaming renderMessageImages={renderMessageImages} />,
    )
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(view.getByText('思考'))
    view.rerender(
      <AssistantMarkdown t={t} blocks={[reasoning, nextBlock]} streaming renderMessageImages={renderMessageImages} />,
    )
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    view.rerender(
      <AssistantMarkdown t={t} blocks={[reasoning, nextBlock]} streaming={false} renderMessageImages={renderMessageImages} />,
    )
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()
    fireEvent.click(view.getByText('思考'))
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('follows the latest streaming line, then restores the settled first line', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('Newest reasoning tokens').parentElement?.getAttribute('data-follow-end'))
      .toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('Newest reasoning tokens keep arriving').parentElement
      ?.getAttribute('data-follow-end')).toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const settledSummary = view.getByText('Inspect the session')
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('运行中')).toBeNull()
    expect(settledSummary.parentElement?.hasAttribute('data-follow-end')).toBe(false)
  })

  it('expands from either Think or the reasoning summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('思考'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    {
      label: 'settled',
      text: '**Comparing checkout and merge bases**\nKeep **reviewing**',
      streaming: false,
    },
    {
      label: 'streaming',
      text: 'Inspect the session\n**Comparing checkout and merge bases**',
      streaming: true,
    },
  ])('strips double-asterisk markers from the $label summary and renders body emphasis', ({ text, streaming }) => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text }]}
        streaming={streaming}
        renderMessageImages={renderMessageImages}
      />,
    )

    expect(view.getByText('Comparing checkout and merge bases')).toBeTruthy()
    expect(view.queryByText('**Comparing checkout and merge bases**')).toBeNull()

    fireEvent.click(view.getByText('思考'))
    expect(view.getByText('Comparing checkout and merge bases').tagName).toBe('STRONG')
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).not.toContain('**')
  })

  it('keeps heading syntax in the collapsed summary and renders compact headings when expanded', () => {
    const text = Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} Section ${index + 1}`)
      .join('\n\n') + '\n\nReasoning body.'
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const summary = view.getByText('# Section 1')
    expect(summary.tagName).toBe('SPAN')
    expect(view.queryByRole('heading')).toBeNull()

    fireEvent.click(summary)
    const compact = view.container.querySelector('[data-markdown-variant="compact"]')
    expect(compact).not.toBeNull()
    expect(compact?.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(6)
    expect(compact?.querySelector('p')?.textContent).toBe('Reasoning body.')

    fireEvent.click(view.getByText('思考'))
    expect(view.getByText('# Section 1').tagName).toBe('SPAN')
    expect(view.queryByRole('heading')).toBeNull()
  })

  it('keeps completed reasoning blocks mounted while the open streaming tail grows', () => {
    const first = '## Investigation\n\n**Check persistence**\n\n'
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: first }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('思考'))
    const heading = view.getByRole('heading', { name: 'Investigation' })
    const emphasis = view.getByText('Check persistence')
    const text = first + Array.from({ length: 8 }, (_, index) => `Paragraph ${index}.`).join('\n\n')
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByRole('heading', { name: 'Investigation' })).toBe(heading)
    expect(view.getByText('Check persistence')).toBe(emphasis)
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).not.toContain('##')
  })

  it('expanded Think drops the inline summary and renders prose without an IN card', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('思考'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })

  it('anchors the sticky-header selector: only an open Think row nests the disclosure row under data-expanded and data-open', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'Inspect the session\nCheck persistence' },
          { kind: 'text', text: 'Answer' },
        ]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    // Collapsed: no `data-open`, so the sticky rule's gate never matches.
    expect(view.container.querySelector('[data-variant="think"] [data-open]')).toBeNull()
    fireEvent.click(view.getByText('思考'))
    expect(
      view.container.querySelector(
        '[data-variant="think"][data-expanded] [data-open] [data-disclosure-row]',
      ),
    ).not.toBeNull()
  })
})
