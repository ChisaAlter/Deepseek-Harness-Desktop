// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { TurnUsageDisclosure } from '../src/client/chat/TurnUsageDisclosure.tsx'
import type { TurnTokenUsage } from '../src/client/contract/chat-nodes.ts'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('TurnUsageDisclosure', () => {
  it('shows the exact compact summary and expands into provider facts', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 5_060,
      cacheReadTokens: 4_940,
      cacheWriteTokens: 0,
      outputTokens: 5_800,
      reasoningTokens: 42,
      totalTokens: 15_800,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    }
    const view = render(<TurnUsageDisclosure usage={usage} t={t} />)

    expect(view.getByText('15.8K tok · Cache hit 49.4%')).toBeTruthy()
    expect(view.queryByRole('definition')).toBeNull()

    fireEvent.click(view.getByRole('button'))
    const details = view.container.querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('Provider / modeldeepseek/deepseek-chat')
    expect(details.textContent).toContain('Uncached input5,060 tok')
    expect(details.textContent).toContain('Cached input4,940 tok')
    expect(details.textContent).toContain('Cache write0 tok')
    expect(details.textContent).toContain('Output5,800 tok (42 tok reasoning)')
    expect(details.textContent).toContain('Total15,800 tok')
  })

  it('omits unavailable optional facts instead of inventing values', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    }
    const view = render(<TurnUsageDisclosure usage={usage} t={t} />)

    expect(view.getByText('150 tok')).toBeTruthy()
    expect(view.queryByText(/Cache hit/)).toBeNull()
    fireEvent.click(view.getByRole('button'))
    expect(view.queryByText('Provider / model')).toBeNull()
    expect(view.queryByText('Cached input')).toBeNull()
    expect(view.queryByText('Cache write')).toBeNull()
    expect(view.queryByText(/reasoning/)).toBeNull()
  })

  it('keeps a partial cache hit below 100 and supports keyboard toggling', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 1,
      cacheReadTokens: 999,
      outputTokens: 100,
      totalTokens: 1_100,
    }
    const view = render(<TurnUsageDisclosure usage={usage} t={t} />)
    expect(view.getByText('1.1K tok · Cache hit 99.9%')).toBeTruthy()

    const disclosure = view.getByRole('button')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(disclosure, { key: ' ' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(disclosure, { key: 'Enter' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
  })
})
