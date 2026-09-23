/** Account Service Definition shared by platform, API, and model consumers. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { AccountDetails, AccountView, SignInAttemptId } from './types.ts'
export type { AccountDetails, AccountProfile, AccountWallet, AccountLinks, AccountView, SignInAttemptId, SignInAttemptView, SignInErrorCode } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deepseekAccount: DeepSeekAccount
  }
}

/** Host-only credentials for an embedded Platform document; never expose through account RPC. */
export interface PlatformSession {
  readonly origin: string
  readonly token: string
  /** Optional dist query value selecting the embedded frontend deployment. */
  readonly embeddedPageDist?: string
  /** Host-only request headers: deployment headers and the provider client identity; never exposed through renderer bootstrap. */
  readonly requestHeaders?: Readonly<Record<string, string>>
}

/** Account operations; only Host consumers can obtain a request credential. */
export abstract class DeepSeekAccount extends Service {
  /** @param ctx - context owning this account implementation. */
  constructor(ctx: Context) { super(ctx, 'deepseekAccount') }
  /**
   * Read stored-account presence and the latest login attempt.
   * @returns a snapshot without credentials or PKCE secrets.
   */
  abstract getState(): Promise<AccountView>
  /**
   * Query Platform profile independently of wallet balances.
   * @returns profile outcome, or null if signed out or the grant changed during the query.
   */
  abstract getProfile(): Promise<AccountDetails['profile'] | null>
  /**
   * Query Platform recharge and bonus wallet balances independently of profile data.
   * @returns balance outcome, or null if signed out or the grant changed during the query.
   */
  abstract getBalance(): Promise<AccountDetails['balance'] | null>
  /**
   * Join an active attempt or start browser authorization.
   * @param locale - active UI language for a new attempt; joining retains its original language.
   * @param callbackOrigin - browser-accessible loopback HTTP origin, including any SSH local port.
   * @param loginSource - initiating UI, used to return from a failed exchange.
   * @returns the initial snapshot without waiting for browser approval.
   */
  abstract startSignIn(locale: string, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView>
  /**
   * Cancel only the named attempt; committing attempts settle before returning.
   * @param id - attempt identity from this Host.
   * @returns state after cancellation or an already-started commit.
   */
  abstract cancelSignIn(id: SignInAttemptId): Promise<AccountView>
  /**
   * Remove the local grant while retaining API keys and tasks; the provider revokes it in the background.
   * @returns the signed-out state after local removal; remote failures never restore the grant.
   */
  abstract signOut(): Promise<AccountView>
  /**
   * Subscribe to snapshots including a complete initial state.
   * @param signal - subscription lifetime; ending it never cancels login.
   * @returns complete snapshots as account state changes.
   */
  abstract watch(signal: AbortSignal): AsyncIterable<AccountView>
  /**
   * Resolve a credential only for the inference origin allowed by the provider.
   * @param url - actual request destination or API base URL.
   * @returns stored token, or undefined for other origins or a signed-out account.
   */
  abstract resolveToken(url: string): Promise<string | undefined>
  /**
   * Read credentials for the configured Platform origin, bound to their issuing environment.
   * @returns a Host-only snapshot, or null while signed out.
   */
  abstract getPlatformSession(): Promise<PlatformSession | null>
}
export default DeepSeekAccount


/** Merge Cookie header pairs by case-sensitive name, retaining unrelated cookies.
 * @param base - existing request cookies.
 * @param override - deployment cookies whose values take precedence.
 * @returns one Cookie header with at most one pair per name.
 */
export function mergePlatformCookies(base: string, override: string): string {
  const cookies = new Map<string, string>()
  for (const header of [base, override]) {
    for (const pair of header.split(';')) {
      const separator = pair.indexOf('=')
      if (separator < 1) continue
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

/**
 * Identify native desktop API requests; null leaves non-desktop requests unchanged.
 * @param platform - Operating system supplied by the desktop composition.
 * @returns Platform request headers shared by account and update-policy clients.
 */
export function desktopClientHeaders(platform: 'darwin' | 'win32' | null): Record<string, string> {
  if (platform === null) return {}
  return { 'x-client-platform': platform === 'win32' ? 'desktop-win' : 'desktop-mac' }
}
