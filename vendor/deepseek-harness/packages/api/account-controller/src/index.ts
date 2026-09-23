/** Authenticated Remote operations for account UI consumers. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type { AccountDetails } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountView, SignInAttemptId } from './types.ts'

/** Account commands and reconnect-safe state stream. */
export class AccountController extends TypertRemoteService {
  static inject = ['deepseekAccount']
  /** @param ctx - Host with the account provider mounted. */
  constructor(ctx: Context) { super(ctx, 'accountController', { namespace: 'account' }) }
  /**
   * Read the safe account projection.
   * @returns current account and attempt state.
   */
  @Remote
  getState(): Promise<AccountView> { return this.ctx.deepseekAccount.getState() }
  /**
   * Query display-safe Platform profile data.
   * @returns profile outcome, or null when the account grant is absent or changed.
   */
  @Remote
  getProfile(): Promise<AccountDetails['profile'] | null> { return this.ctx.deepseekAccount.getProfile() }
  /**
   * Query Platform recharge-wallet balances.
   * @returns balance outcome, or null when the account grant is absent or changed.
   */
  @Remote
  getBalance(): Promise<AccountDetails['balance'] | null> { return this.ctx.deepseekAccount.getBalance() }
  /**
   * Begin browser sign-in.
   * @param locale - active UI language for a new attempt.
   * @param callbackOrigin - browser-accessible loopback HTTP origin.
   * @param loginSource - initiating UI, used to return from a failed exchange.
   * @returns a new or already-active login attempt.
   */
  @Remote
  startSignIn(locale: string, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView> { return this.ctx.deepseekAccount.startSignIn(locale, callbackOrigin, loginSource) }
  /**
   * Cancel the named local attempt.
   * @param attemptId - attempt to cancel.
   * @returns settled cancellation or commit state.
   */
  @Remote
  cancelSignIn(attemptId: SignInAttemptId): Promise<AccountView> { return this.ctx.deepseekAccount.cancelSignIn(attemptId) }
  /**
   * Remove the local account grant and revoke it through Platform in the background, without deleting API keys.
   * @returns state after removing the local account grant.
   */
  @Remote
  signOut(): Promise<AccountView> { return this.ctx.deepseekAccount.signOut() }
  /**
   * Stream the safe account projection.
   * @param signal - stream lifetime.
   * @returns initial snapshot and subsequent changes.
   */
  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<AccountView> { return this.ctx.deepseekAccount.watch(signal) }
}
export default AccountController
