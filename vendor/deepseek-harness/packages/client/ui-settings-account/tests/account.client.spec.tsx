// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountDetails, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DEFAULT_THEME_SETTINGS } from '@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts'
import type { PlatformBridge } from '../src/client/PlatformOverlay.tsx'
import { AccountSection, type AccountSectionInjected, type AccountSnapshot } from '../src/client/AccountSection.tsx'
import type { AccountMenuProps } from '../src/client/AccountMenu.tsx'
import type {} from '../src/client/index.ts'
import { en, zh, type AccountKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** One resolved theme snapshot per scheme; the slot's theme hook serves these in the application. */
const themeOf = (colorScheme: 'light' | 'dark'): ThemeSnapshot => ({
  ...DEFAULT_THEME_SETTINGS, preference: colorScheme,
  active: { id: colorScheme, colorScheme, tokens: {} }, themes: [], revision: 0,
  families: [],
})

function operationsOf(state: Omit<AccountView, 'links'>, details?: Partial<AccountDetails>, platform?: PlatformBridge):
  AccountSectionInjected & Pick<AccountMenuProps, 'useLauncherActions' | 'renderSlot'> {
  return {
    ...platform === undefined ? {} : { platform },
    hooks: {
      account: {
        getSnapshot: () => ({ view: { ...state, links: { usageUrl: 'http://localhost:8081/usage', topUpUrl: 'http://localhost:8081/top_up' } }, details, failed: false }),
        subscribe: () => () => {},
      },
      theme: { getSnapshot: () => themeOf('light'), subscribe: () => () => {} },
      launcherActions: { getSnapshot: () => [], subscribe: () => () => {} },
    },
    useLauncherActions: selector => selector([]),
    renderSlot: (() => null) as AccountMenuProps['renderSlot'],
    contactUs: vi.fn(), showLogin: vi.fn(), setOnboarding: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve()), cancel: vi.fn(() => Promise.resolve()), signOut: vi.fn(() => Promise.resolve()),
  }
}

it('opens the contributed Remote action from the account menu and restores focus on close', async () => {
  const operations = operationsOf({ status: 'signed-out', attempt: null })
  const recordSlot = vi.fn()
  const renderSlot: AccountMenuProps['renderSlot'] = (key, owner, options) => {
    recordSlot(key, owner, options)
    return <div data-testid="remote-popup" />
  }
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  render(<AccountMenu {...({} as GlobalStandardProps)} {...operations}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    useLauncherActions={selector => selector([{ id: 'remote', order: 50, label: 'Remote' }])}
    renderSlot={renderSlot} wide openOnboarding={() => {}} openSettings={() => {}}
    t={key => key in en ? en[key as AccountKey] : key} />)
  const accountButton = screen.getByRole('button', { name: en.menu })
  fireEvent.click(accountButton)
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([en.settings, 'Remote', en.contactUs, en.signIn])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remote' }))
  expect(screen.getByTestId('remote-popup')).toBeTruthy()
  const call = recordSlot.mock.calls.at(-1)!
  expect(call[0]).toBe('settings.launcher.action')
  expect(call[2]).toEqual({ only: 'remote' })
  act(() => { (call[1] as { close: () => void }).close() })
  expect(document.activeElement).toBe(accountButton)
})

function mount(state: Omit<AccountView, 'links'>, copy: typeof en | typeof zh = en, details?: Partial<AccountDetails>, platform?: PlatformBridge) {
  const operations = operationsOf(state, details, platform)
  // AccountSection consumes no global hooks; the slot supplies them in the application.
  const globals = {} as GlobalStandardProps
  render(<AccountSection {...globals} {...operations}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    close={() => {}} t={key => key in copy ? copy[key as AccountKey] : key} />)
  return operations
}

it.each([en, zh])('renders account cards without inventing profile or balance data', async (copy) => {
  mount({ status: 'credential-stored', attempt: null }, copy)
  expect(screen.getByText(copy.signedIn)).toBeTruthy()
  expect(screen.getAllByText(copy.loading)).toHaveLength(2)
  expect(screen.getByRole('link', { name: copy.usage }).getAttribute('href')).toBe('http://localhost:8081/usage')
  expect(screen.getByRole('link', { name: copy.topUp }).getAttribute('href')).toBe('http://localhost:8081/top_up')
  expect(screen.queryByRole('button', { name: copy.signOut })).toBeNull()
  expect(document.body.textContent).not.toContain('209.00')
  await expect(`${screen.getByRole('region').textContent}\n`).toMatchFileSnapshot(`./expected/account-${copy === en ? 'en' : 'zh'}.txt`)
})

it('starts sign-in and disables cancellation during persistence', async () => {
  const operations = mount({ status: 'signed-out', attempt: null })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.signIn })) })
  expect(operations.start).toHaveBeenCalledOnce()
  cleanup()
  mount({ status: 'signed-out', attempt: { id: 'attempt' as SignInAttemptId, phase: 'committing' } })
  expect(screen.getByRole('button', { name: en.cancel }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
})

it.each([en, zh])('opens settings and signs out from the sidebar account menu', async (copy) => {
  const signOut = vi.fn(() => Promise.resolve())
  const openSettings = vi.fn()
  const operations = mount({ status: 'credential-stored', attempt: null }, copy)
  cleanup()
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  render(<AccountMenu {...({} as GlobalStandardProps)} {...operations} signOut={signOut}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())} wide openOnboarding={() => {}} openSettings={openSettings}
    t={key => key in copy ? copy[key as AccountKey] : key} />)
  fireEvent.click(screen.getByRole('button', { name: copy.menu }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([copy.settings, copy.contactUs, copy.signOut])
  await expect(`${screen.getByRole('menu').textContent}\n`).toMatchFileSnapshot(`./expected/menu-${copy === en ? 'en' : 'zh'}.txt`)
  fireEvent.click(screen.getByRole('menuitem', { name: copy.settings }))
  expect(openSettings).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: copy.menu }))
  fireEvent.click(screen.getByRole('menuitem', { name: copy.contactUs }))
  expect(operations.contactUs).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: copy.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: copy.signOut })) })
  expect(signOut).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('reports a failed start in the login dialog, not as a sidebar alert', async () => {
  const operations = mount({ status: 'signed-out', attempt: null })
  cleanup()
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  const links = { usageUrl: 'http://localhost:8081/usage', topUpUrl: 'http://localhost:8081/top_up' }
  let snapshot: AccountSnapshot = { view: { status: 'signed-out', attempt: null, links }, details: undefined, failed: false }
  // The plugin's start publishes the failure through the account snapshot, then rejects.
  const start = vi.fn((): Promise<void> => {
    snapshot = { ...snapshot, loginVisible: true, loginFailed: true }
    return Promise.reject(new Error('account start failed'))
  })
  const view = render(<AccountMenu {...({} as GlobalStandardProps)} {...operations} start={start}
    useAccount={selector => selector(snapshot)} useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    wide openOnboarding={() => {}} openSettings={() => {}}
    t={key => key in en ? en[key as AccountKey] : key} />)
  fireEvent.click(screen.getByRole('button', { name: en.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: en.signIn })) })
  expect(start).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).toBeNull()
  view.rerender(<AccountMenu {...({} as GlobalStandardProps)} {...operations} start={start}
    useAccount={selector => selector(snapshot)} useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    wide openOnboarding={() => {}} openSettings={() => {}}
    t={key => key in en ? en[key as AccountKey] : key} />)
  expect(screen.getByRole('dialog').textContent).toContain(en.failed)
  expect(screen.queryByRole('alert')).toBeNull()
  // The dialog is the only place that reports the failure, so its copy appears once.
  expect(document.body.textContent.split(en.failed)).toHaveLength(2)
  await expect(`${document.body.textContent}\n`).toMatchFileSnapshot('./expected/login-failed-en.txt')
})

it('keeps the sidebar alert for a failed sign-out', async () => {
  const operations = mount({ status: 'credential-stored', attempt: null })
  cleanup()
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  render(<AccountMenu {...({} as GlobalStandardProps)} {...operations}
    signOut={() => Promise.reject(new Error('account sign-out failed'))}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())} wide
    openOnboarding={() => {}} openSettings={() => {}} t={key => key in en ? en[key as AccountKey] : key} />)
  fireEvent.click(screen.getByRole('button', { name: en.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: en.signOut })) })
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
})

it.each([en, zh])('renders Platform profile and recharge wallet balances', async (copy) => {
  mount({ status: 'credential-stored', attempt: null }, copy, {
    profile: { status: 'ready', value: { id: null, name: 'Harness Mock (TEST ONLY)', contact: '138****0000' } },
    balance: { status: 'ready', bonusWallets: [], value: [{ currency: 'CNY', balance: '1234.56000000' }, { currency: 'USD', balance: '0.00000100' }] },
  })
  expect(screen.getByText('Harness Mock (TEST ONLY)')).toBeTruthy()
  expect(screen.getByText('138****0000')).toBeTruthy()
  expect(screen.getByText('¥1,234.56')).toBeTruthy()
  expect(screen.getByText('<$0.01')).toBeTruthy()
  await expect(`${screen.getByRole('region').textContent}\n`).toMatchFileSnapshot(`./expected/details-${copy === en ? 'en' : 'zh'}.txt`)
})

it.each([en, zh])('shows the signed-out settings prompt without balance or Platform links', async (copy) => {
  mount({ status: 'signed-out', attempt: null }, copy)
  expect(screen.getByText(copy.settingsSignedOutTitle)).toBeTruthy()
  expect(screen.getByText(copy.settingsSignedOutDescription)).toBeTruthy()
  expect(screen.queryByText(copy.balance)).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()
  await expect(`${screen.getByRole('region').textContent}\n`)
    .toMatchFileSnapshot(`./expected/account-signed-out-${copy === en ? 'en' : 'zh'}.txt`)
})


it('opens usage inside Desktop and returns to the same Account settings', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const platform: PlatformBridge = { open: vi.fn(async () => {}), setBounds: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  mount({ status: 'credential-stored', attempt: null }, en, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: en.usage })) })
  expect(platform.open).toHaveBeenCalledWith('usage', { x: 0, y: 0, width: 0, height: 0 })
  const back = screen.getByRole('button', { name: en.backToHarness })
  await expect(`${back.parentElement!.parentElement!.textContent}\n`).toMatchFileSnapshot('./expected/platform-header-en.txt')
  await act(async () => { fireEvent.click(back) })
  expect(platform.close).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: en.backToHarness })).toBeNull()
  expect(screen.getByRole('region', { name: en.nav })).toBeTruthy()
})

it('keeps a return action available when the native document fails to load', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const platform: PlatformBridge = {
    open: vi.fn(async () => { throw new Error('load failed') }), setBounds: vi.fn(async () => {}), close: vi.fn(async () => {}),
  }
  mount({ status: 'credential-stored', attempt: null }, zh, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: zh.topUp })) })
  expect(platform.open).toHaveBeenCalledWith('top-up', { x: 0, y: 0, width: 0, height: 0 })
  expect(screen.getByText(zh.platformFailed)).toBeTruthy()
  const back = screen.getByRole('button', { name: zh.backToHarness })
  await expect(`${back.parentElement!.parentElement!.textContent}\n`).toMatchFileSnapshot('./expected/platform-header-zh.txt')
  await act(async () => { fireEvent.click(back) })
  expect(platform.close).toHaveBeenCalledOnce()
})

it.each([en, zh])('retries the failed Platform destination and removes the error after loading', async (copy) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const loaded = Promise.withResolvers<undefined>()
  const open = vi.fn<PlatformBridge['open']>()
    .mockRejectedValueOnce(new Error('load failed'))
    .mockRejectedValueOnce(new Error('still offline'))
    .mockReturnValueOnce(loaded.promise)
  const platform: PlatformBridge = { open, setBounds: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  mount({ status: 'credential-stored', attempt: null }, copy, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: copy.topUp })) })
  await expect(`${screen.getByRole('dialog').textContent}\n`)
    .toMatchFileSnapshot(`./expected/platform-error-${copy === en ? 'en' : 'zh'}.txt`)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.platformRetry })) })
  expect(screen.getByText(copy.platformFailed)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.platformRetry })) })
  expect(open.mock.calls.map(([page]) => page)).toEqual(['top-up', 'top-up', 'top-up'])
  expect(screen.queryByRole('button', { name: copy.platformRetry })).toBeNull()
  expect(screen.getByRole('status', { name: copy.loading })).toBeTruthy()
  await act(async () => { loaded.resolve(undefined); await loaded.promise })
  expect(screen.queryByText(copy.platformFailed)).toBeNull()
  expect(screen.queryByRole('status', { name: copy.loading })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.backToHarness })) })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(platform.close).toHaveBeenCalledTimes(3)
})

it('ignores a retried document completing after returning to Account', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const loaded = Promise.withResolvers<undefined>()
  const open = vi.fn<PlatformBridge['open']>()
    .mockRejectedValueOnce(new Error('load failed')).mockReturnValueOnce(loaded.promise)
  const platform: PlatformBridge = { open, setBounds: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  mount({ status: 'credential-stored', attempt: null }, en, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: en.usage })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.platformRetry })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.backToHarness })) })
  await act(async () => { loaded.resolve(undefined); await loaded.promise })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('region', { name: en.nav })).toBeTruthy()
  expect(platform.close).toHaveBeenCalledTimes(2)
})

it('shows the profile while the balance is still loading', async () => {
  mount({ status: 'credential-stored', attempt: null }, en, {
    profile: { status: 'ready', value: { id: null, name: 'Ready User', contact: '138****0000' } },
  })
  expect(screen.getByText('Ready User')).toBeTruthy()
  expect(screen.getByText(en.loading)).toBeTruthy()
  expect(screen.queryByText(en.balanceUnavailable)).toBeNull()
  await expect(`${screen.getByRole('region').textContent}\n`).toMatchFileSnapshot('./expected/profile-before-balance.txt')
})


it.each(['usage', 'top-up'] as const)('shows an accessible spinner until %s finishes loading', async (page) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const loaded = Promise.withResolvers<undefined>()
  const platform: PlatformBridge = { open: () => loaded.promise, setBounds: async () => {}, close: async () => {} }
  mount({ status: 'credential-stored', attempt: null }, en, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: page === 'usage' ? en.usage : en.topUp })) })
  const status = screen.getByRole('status', { name: en.loading })
  expect({ accessibleName: status.getAttribute('aria-label'), visibleText: status.textContent }).toMatchInlineSnapshot(`
    {
      "accessibleName": "Loading…",
      "visibleText": "",
    }
  `)
  expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull()
  expect(screen.getByRole('button', { name: en.backToHarness })).toBeTruthy()
  await act(async () => { loaded.resolve(undefined) })
  expect(screen.queryByRole('status', { name: en.loading })).toBeNull()
})


it.each([
  ['Preferred name', '138****0000', 'Preferred name'],
  [null, '138****0000', '138****0000'],
  [null, 'u***@example.com', 'u***@example.com'],
  [null, null, en.signedIn],
])('uses the sidebar profile label %s / %s', async (name, contact, expected) => {
  const operations = mount({ status: 'credential-stored', attempt: null }, en, {
    profile: { status: 'ready', value: { id: null, name, contact } },
  })
  cleanup()
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  render(<AccountMenu {...({} as GlobalStandardProps)} {...operations}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    wide openSettings={() => {}} openOnboarding={() => {}} t={key => en[key as AccountKey]} />)
  expect(screen.getByRole('button', { name: en.menu }).textContent).toBe(expected)
})

it('shows the profile image in settings and the sidebar, with independent load-error fallbacks', async () => {
  const operations = mount({ status: 'credential-stored', attempt: null }, en, {
    profile: { status: 'ready', value: { id: null, name: 'User', contact: null, avatarUrl: 'https://example.test/avatar.png' } },
  })
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  render(<AccountMenu {...({} as GlobalStandardProps)} {...operations}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(operations.hooks.theme.getSnapshot())}
    wide openSettings={() => {}} openOnboarding={() => {}} t={key => en[key as AccountKey]} />)
  const images = document.querySelectorAll('img')
  expect(images).toHaveLength(2)
  for (const image of images) {
    expect(image.getAttribute('src')).toBe('https://example.test/avatar.png')
    const parent = image.parentElement!
    fireEvent.error(image)
    expect(parent.querySelector('img')).toBeNull()
    expect(parent.querySelector('svg')).not.toBeNull()
  }
})

it('retries a changed avatar URL after an image fails', async () => {
  const { AccountAvatar } = await import('../src/client/AccountAvatar.tsx')
  const view = render(<AccountAvatar />)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('svg')).not.toBeNull()
  view.rerender(<AccountAvatar url="https://example.test/old.png" />)
  fireEvent.error(view.container.querySelector('img')!)
  expect(view.container.querySelector('svg')).not.toBeNull()
  view.rerender(<AccountAvatar url="https://example.test/new.png" />)
  expect(view.container.querySelector('img')!.getAttribute('src')).toBe('https://example.test/new.png')
  view.rerender(<AccountAvatar url={null} />)
  expect(view.container.querySelector('img')).toBeNull()
})

it.each([en, zh])('renders positive bonus wallets separately from recharge balances', async (copy) => {
  mount({ status: 'credential-stored', attempt: null }, copy, {
    balance: { status: 'ready', value: [{ currency: 'CNY', balance: '209.00' }, { currency: 'USD', balance: '20.07' }],
      bonusWallets: [{ currency: 'CNY', balance: '5.00' }, { currency: 'USD', balance: '0.000001' }] },
  })
  expect(screen.getByText(copy.balance).parentElement!.textContent).toBe(`${copy.balance}¥209.00$20.07`)
  expect(screen.getByText(copy.bonusBalance).parentElement!.textContent).toBe(`${copy.bonusBalance}¥5.00<$0.01`)
  await expect(`${screen.getByRole('region').textContent}\n`)
    .toMatchFileSnapshot(`./expected/bonus-${copy === en ? 'en' : 'zh'}.txt`)
})

it.each([[], [{ currency: 'CNY' as const, balance: '0.00' }, { currency: 'USD' as const, balance: '-1.00' }]].map(bonusWallets => ({ bonusWallets })))(
  'hides bonus wallets without positive credit', ({ bonusWallets }) => {
    mount({ status: 'credential-stored', attempt: null }, en, {
      balance: { status: 'ready', value: [{ currency: 'CNY', balance: '0' }], bonusWallets },
    })
    expect(screen.queryByText(en.bonusBalance)).toBeNull()
    expect(screen.getByText('¥0.00')).toBeTruthy()
  },
)

it('opens more account information externally without invoking the embedded Platform bridge', () => {
  const platform: PlatformBridge = { open: vi.fn(), close: vi.fn(), setBounds: vi.fn() }
  mount({ status: 'credential-stored', attempt: null }, en, undefined, platform)
  const link = screen.getByRole('link', { name: en.accountInfo })
  expect(link.getAttribute('href')).toBe('https://platform.deepseek.com')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  fireEvent.click(link)
  expect(platform.open).not.toHaveBeenCalled()
})

it.each(['initializing', 'waiting-browser', 'exchanging'] as const)('shows %s and lets the user cancel the active attempt', async (phase) => {
  const operations = mount({ status: 'signed-out', attempt: { id: 'attempt' as SignInAttemptId, phase, authorizeUrl: 'https://example.test/authorize' } })
  expect(screen.getByRole('link', { name: en.open }).getAttribute('href')).toBe('https://example.test/authorize?theme=light')
  expect(screen.getByRole('status').textContent).toBe(phase === 'initializing' ? en.initializing : phase === 'waiting-browser' ? en.waiting : en.completing)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.cancel })) })
  expect(operations.cancel).toHaveBeenCalledExactlyOnceWith('attempt')
})

it('opens the authorization link with the active Desktop palette and follows later switches', () => {
  const authorizeUrl = 'https://platform.deepseek.com/dsh/authorize?state=example'
  const operations = operationsOf({ status: 'signed-out', attempt: { id: 'attempt' as SignInAttemptId, phase: 'waiting-browser', authorizeUrl } })
  const element = (theme: ThemeSnapshot) => <AccountSection {...({} as GlobalStandardProps)} {...operations}
    useAccount={selector => selector(operations.hooks.account.getSnapshot())}
    useTheme={selector => selector(theme)} close={() => {}} t={key => key in en ? en[key as AccountKey] : key} />
  const view = render(element(themeOf('dark')))
  expect(screen.getByRole('link', { name: en.open }).getAttribute('href'))
    .toBe('https://platform.deepseek.com/dsh/authorize?state=example&theme=dark')
  view.rerender(element(themeOf('light')))
  expect(screen.getByRole('link', { name: en.open }).getAttribute('href'))
    .toBe('https://platform.deepseek.com/dsh/authorize?state=example&theme=light')
})

it.each(['failed', 'expired'] as const)('allows a new sign-in after the attempt is %s', (phase) => {
  mount({ status: 'signed-out', attempt: { id: 'attempt' as SignInAttemptId, phase } })
  expect(screen.getByRole('button', { name: en.signIn }).hasAttribute('disabled')).toBe(false)
})

it('shows unavailable details and keeps external Platform links usable in a browser', () => {
  mount({ status: 'credential-stored', attempt: null }, en, {
    profile: { status: 'failed' }, balance: { status: 'failed' },
  })
  expect(screen.getByText(en.profileUnavailable)).toBeTruthy()
  expect(screen.getByText(en.balanceUnavailable)).toBeTruthy()
  for (const name of [en.usage, en.topUp]) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    screen.getByRole('link', { name }).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  }
})

it('reports a rejected settings login and disables login while initial state is unavailable', async () => {
  const operations = mount({ status: 'signed-out', attempt: null })
  cleanup()
  let snapshot: AccountSnapshot = { view: undefined, details: undefined, failed: true }
  const props = { ...({} as GlobalStandardProps), ...operations,
    start: vi.fn(async () => { throw new Error('unavailable') }),
    useAccount: <T,>(select: (value: AccountSnapshot) => T) => select(snapshot),
    useTheme: <T,>(select: (value: ThemeSnapshot) => T) => select(operations.hooks.theme.getSnapshot()), close: () => {},
    t: (key: string) => en[key as AccountKey],
  }
  const view = render(<AccountSection {...props} />)
  expect(screen.getByRole('button', { name: en.signIn }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(en.failed)
  snapshot = operations.hooks.account.getSnapshot()
  view.rerender(<AccountSection {...props} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.signIn })) })
  expect(screen.getByRole('status').textContent).toBe(en.failed)
})

it('dismisses a collapsed menu and hands its login dialog to the API-key onboarding step', async () => {
  const operations = mount({ status: 'credential-stored', attempt: null }, en, { profile: { status: 'failed' } })
  cleanup()
  const { AccountMenu } = await import('../src/client/AccountMenu.tsx')
  const openOnboarding = vi.fn()
  let snapshot = operations.hooks.account.getSnapshot()
  const props = { ...({} as GlobalStandardProps), ...operations, wide: false, openSettings: vi.fn(), openOnboarding,
    useAccount: <T,>(select: (value: AccountSnapshot) => T) => select(snapshot),
    useTheme: <T,>(select: (value: ThemeSnapshot) => T) => select(operations.hooks.theme.getSnapshot()),
    t: (key: string) => en[key as AccountKey] }
  const view = render(<AccountMenu {...props} />)
  expect(screen.getByRole('button', { name: en.menu }).textContent).toBe('')
  fireEvent.click(screen.getByRole('button', { name: en.menu }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  snapshot = { ...snapshot, view: { ...snapshot.view!, status: 'signed-out' }, loginVisible: true }
  view.rerender(<AccountMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  expect(operations.showLogin).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: en.addApiKey }))
  expect(openOnboarding).toHaveBeenCalledExactlyOnceWith('deepseek-official')
  snapshot = { ...snapshot, onboarding: true }
  view.rerender(<AccountMenu {...props} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('reports resize failure, ignores late native failures, and tolerates a removed IPC receiver', async () => {
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  const loaded = Promise.withResolvers<undefined>()
  const platform: PlatformBridge = { open: () => loaded.promise,
    setBounds: vi.fn(async () => { throw new Error('resize failed') }), close: vi.fn(async () => { throw new Error('window gone') }) }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('tabindex', '0')
  document.body.append(svg)
  onTestFinished(() => { svg.remove() })
  svg.focus()
  mount({ status: 'credential-stored', attempt: null }, en, undefined, platform)
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: en.usage })) })
  await act(async () => { resize!() })
  expect(platform.setBounds).toHaveBeenCalled()
  expect(screen.getByText(en.platformFailed)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.backToHarness })) })
  await act(async () => { loaded.reject(new Error('late failure')); await loaded.promise.catch(() => {}) })
  expect(screen.queryByRole('dialog')).toBeNull()
})
