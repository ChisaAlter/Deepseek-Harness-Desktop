/** Account settings renders safe Host state and explicit login actions. */
import { Big } from 'big.js'
import { useEffect, useState } from 'react'
import { Button, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountDetails, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { PropsRuntime, PropsLocale, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { PlatformOverlay, type PlatformBridge } from './PlatformOverlay.tsx'
import { formatBalance } from './formatBalance.ts'
import { AccountAvatar } from './AccountAvatar.tsx'
import { authorizeUrlWithTheme } from './authorize-url.ts'
import css from './AccountSection.module.css'

/** Safe account snapshot shared by the settings page and launcher. */
export interface AccountSnapshot {
  /** Latest Host state, absent until the stream responds. */
  view: AccountView | undefined
  /** Sanitized profile and balance query outcomes, absent while loading. */
  details: Partial<AccountDetails> | undefined
  /** Whether the state stream failed. */
  failed: boolean
  /** Explicitly opened account dialog outside onboarding. */
  loginVisible?: boolean
  /** Latest explicit start request failed before a Host state was available. */
  loginFailed?: boolean
  /** Mounted onboarding owns the dialog while active. */
  onboarding?: boolean
}

/** Host operations injected into the Cordis-free account component. */
export interface AccountSectionInjected {
  /** Desktop-only commands; absent in ordinary browsers. */
  platform?: PlatformBridge

  /** Account stream owned by the Host and theme snapshots published by the renderer, observed through framework hooks. */
  hooks: {
    account: HostObservable<AccountSnapshot>
    /** Palette the Platform login pages follow. */
    theme: HostObservable<ThemeSnapshot>
  }
  /** @returns after account details are refreshed; concurrent refreshes share a request. */
  refresh: () => Promise<void>
  /** Open the external support questionnaire with the current build and browser environment. */
  contactUs: () => void
  /** Open or dismiss the login dialog. */
  showLogin: (visible: boolean) => void
  /** Claim dialog ownership for the onboarding step. */
  setOnboarding: (active: boolean) => void
  /** @returns after the login attempt is created. */
  start: () => Promise<void>
  /** @param id - attempt to cancel. @returns after cancellation or an already-admitted commit. */
  cancel: (id: SignInAttemptId) => Promise<void>
  /** @returns after local account credentials are removed. */
  signOut: () => Promise<void>
}
/** Composed account section props. */
export type AccountSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>
/** @param props - localized actions and account subscription. @returns account settings UI. */
export function AccountSection({ t, useAccount, useTheme, start, cancel, refresh, platform }: AccountSectionProps) {
  const { view: state, details, failed: streamFailed } = useAccount(value => value)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [platformPage, setPlatformPage] = useState<'usage' | 'top-up'>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void refresh() }, [refresh])
  const profile = details?.profile?.status === 'ready' ? details.profile.value : undefined
  const wallets = details?.balance?.status === 'ready' ? details.balance.value : undefined
  const bonusWallets = details?.balance?.status === 'ready'
    ? details.balance.bonusWallets.filter(wallet => new Big(wallet.balance).gt(0)) : []
  const attempt = state?.attempt
  const active = attempt !== null && attempt !== undefined
    && ['initializing', 'waiting-browser', 'exchanging', 'committing'].includes(attempt.phase)
  const signedIn = state?.status === 'credential-stored'
  useEffect(() => { if (!signedIn) setPlatformPage(undefined) }, [signedIn])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    try { await action() } catch { setFailed(true) } finally { setBusy(false) }
  }
  const status = failed || streamFailed || attempt?.phase === 'failed' ? t('failed')
    : attempt?.phase === 'expired' ? t('expired')
      : active ? t(attempt.phase === 'initializing' ? 'initializing' : attempt.phase === 'waiting-browser' ? 'waiting' : 'completing')
        : signedIn ? profile?.contact ?? t(details?.profile === undefined ? 'loading' : 'profileUnavailable') : t('signInDescription')
  if (!signedIn && !active) return (
    <section className={css.signedOut} aria-label={t('nav')}>
      <div className={css.signedOutContent}>
        <div className={css.signedOutCopy}>
          <span className={css.signedOutTitle}>{t('settingsSignedOutTitle')}</span>
          <span className={css.signedOutDescription} role="status">
            {failed || streamFailed ? t('failed') : t('settingsSignedOutDescription')}
          </span>
        </div>
        <Button variant="primary" className={css.signInButton} disabled={busy || state === undefined}
          onClick={() => { void run(start) }}>{t('signIn')}</Button>
      </div>
    </section>
  )
  return (
    <section className={css.section} aria-label={t('nav')}>
      {platformPage !== undefined && platform !== undefined && signedIn && <PlatformOverlay
        bridge={platform} page={platformPage} backLabel={t('backToHarness')}
        loadingLabel={t('loading')} failureLabel={t('platformFailed')} retryLabel={t('platformRetry')} onClose={() => { setPlatformPage(undefined) }} />}
      <div className={css.card}>
        <div className={css.identity}>
          <span className={css.avatar}><AccountAvatar url={signedIn ? profile?.avatarUrl : null} /></span>
          <div className={css.identityCopy}>
            <span className={css.name}>{signedIn ? profile?.name ?? t('signedIn') : t('signedOut')}</span>
            <span className={css.status} role="status">{status}</span>
          </div>
        </div>
        {signedIn && <a className={css.accountInfo} href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer">
          {t('accountInfo')}<IconRightUpOutlineRegular size={12} />
        </a>}
      </div>
      {active && <div className={css.actions}>
        {attempt.authorizeUrl && <a className={css.linkButton} href={authorizeUrlWithTheme(attempt.authorizeUrl, colorScheme)}
          target="_blank" rel="noreferrer">
          {t('open')}
        </a>}
        <Button variant="outline" className={css.button} disabled={busy || attempt.phase === 'committing'}
          onClick={() => { void run(() => cancel(attempt.id)) }}>{t('cancel')}</Button>
      </div>}
      <div className={css.balanceCard}>
        <div className={css.row}>
          <span>{t('balance')}</span>
          {signedIn && wallets !== undefined && wallets.length > 0
            ? <span className={css.amount}>{wallets.map(wallet => <span key={wallet.currency}>
              {formatBalance(wallet.balance, wallet.currency === 'CNY' ? '¥' : '$')}
            </span>)}</span>
            : <span className={css.unavailable}>{t(!signedIn ? 'balanceSignedOut'
              : details?.balance === undefined ? 'loading' : 'balanceUnavailable')}</span>}
        </div>
        {signedIn && bonusWallets.length > 0 && <>
          <div className={css.divider} />
          <div className={css.row}>
            <span>{t('bonusBalance')}</span>
            <span className={css.amount}>{bonusWallets.map(wallet => <span key={wallet.currency}>
              {formatBalance(wallet.balance, wallet.currency === 'CNY' ? '¥' : '$')}
            </span>)}</span>
          </div>
        </>}
        <div className={css.divider} />
        <div className={css.row}>
          <span className={css.secondary}>{t('more')}</span>
          <div className={css.links}>
            <a className={css.linkButton} href={state?.links.usageUrl} aria-disabled={state === undefined} target="_blank" rel="noreferrer"
              onClick={(event) => { if (platform !== undefined && signedIn) { event.preventDefault(); setPlatformPage('usage') } }}>{t('usage')}</a>
            <a className={`${css.linkButton} ${css.primary}`} href={state?.links.topUpUrl} aria-disabled={state === undefined}
              target="_blank" rel="noreferrer"
              onClick={(event) => { if (platform !== undefined && signedIn) { event.preventDefault(); setPlatformPage('top-up') } }}>{t('topUp')}</a>
          </div>
        </div>
      </div>
    </section>
  )
}
