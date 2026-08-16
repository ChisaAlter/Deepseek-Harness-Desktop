// @vitest-environment jsdom
/** Usage settings section: empty, populated, failed, and range switch. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, UsageSummaryView } from '@deepseek-ai/dsh-api-remotes/client'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionInjected, UsageSectionProps } from '../src/client/UsageSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: UsageSectionInjected['t'] = (key, params) => {
  const template = en[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

const EMPTY: UsageSummaryView = {
  rangeDays: 30,
  totalTokens: 0,
  sessionCount: 0,
  messageCount: 0,
  activeDays: 0,
  currentStreak: 0,
  topModel: null,
  heatmap: [
    { date: '2026-08-15', tokens: 0 },
    { date: '2026-08-16', tokens: 0 },
  ],
  daily: [
    { date: '2026-08-15', byModel: [] },
    { date: '2026-08-16', byModel: [] },
  ],
  models: [],
}

const POPULATED: UsageSummaryView = {
  rangeDays: 30,
  totalTokens: 100,
  sessionCount: 5,
  messageCount: 7,
  activeDays: 1,
  currentStreak: 1,
  topModel: { name: 'glm-5.3', share: 72 },
  heatmap: [{ date: '2026-08-16', tokens: 100 }],
  daily: [{ date: '2026-08-16', byModel: [{ model: 'glm-5.3', tokens: 72 }, { model: 'flash', tokens: 28 }] }],
  models: [
    { model: 'glm-5.3', tokens: 72, share: 72 },
    { model: 'flash', tokens: 28, share: 28 },
  ],
}

function usageApi(summary: UsageSummaryView | 'fail' = EMPTY) {
  return {
    usage: {
      summary: vi.fn(async (payload: { rangeDays: 7 | 30 }) => {
        if (summary === 'fail') {
          return { result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } }
        }
        return { result: { ok: true as const, value: { ...summary, rangeDays: payload.rangeDays } } }
      }),
    },
  }
}

function renderSection(overrides: Partial<UsageSectionInjected> = {}) {
  const injected: UsageSectionInjected = {
    api: usageApi() as unknown as Pick<IApiClient, 'usage'>,
    t,
    locale: 'en',
    ...overrides,
  }
  render(<UsageSection {...injected} />)
  return injected
}

describe('UsageSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as UsageSectionProps
    render(<UsageSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('shows zeros and the heatmap after a successful empty load', async () => {
    renderSection()
    expect(await screen.findByText(en.tokens)).toBeTruthy()
    expect(screen.getByText(en.none)).toBeTruthy()
    expect(screen.getByText(en.heatmap)).toBeTruthy()
  })

  it('renders populated totals and the top model', async () => {
    renderSection({ api: usageApi(POPULATED) as unknown as Pick<IApiClient, 'usage'> })
    expect(await screen.findByText('72% share')).toBeTruthy()
    expect(screen.getAllByText('glm-5.3').length).toBeGreaterThan(0)
    expect(screen.getByText(en.models)).toBeTruthy()
  })

  it('shows the load failure when the RPC refuses', async () => {
    renderSection({ api: usageApi('fail') as unknown as Pick<IApiClient, 'usage'> })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(en.loadFailed)).toBeTruthy()
  })

  it('refetches when the range switches from 30 to 7 days', async () => {
    const api = usageApi(POPULATED)
    renderSection({ api: api as unknown as Pick<IApiClient, 'usage'> })
    expect(await screen.findByText('72% share')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.last7 }))
    await waitFor(() => {
      expect(api.usage.summary.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(api.usage.summary.mock.calls.at(-1)?.[0]).toMatchObject({ rangeDays: 7 })
  })
})
