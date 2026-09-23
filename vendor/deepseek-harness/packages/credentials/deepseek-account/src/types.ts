/** Client-safe account state; credentials never cross this projection. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one local login attempt, unrelated to the platform request ID. */
export type SignInAttemptId = Branded<'SignInAttemptId'>
/** Safe failure codes rendered through the caller's locale dictionary. */
export type SignInErrorCode = 'network' | 'protocol' | 'expired' | 'storage'
/** Latest login attempt, including terminal outcomes until the next attempt. */
export interface SignInAttemptView {
  readonly id: SignInAttemptId
  readonly phase: 'initializing' | 'waiting-browser' | 'exchanging' | 'committing' | 'succeeded' | 'cancelled' | 'expired' | 'failed'
  readonly authorizeUrl?: string
  readonly expiresAt?: number
  readonly errorCode?: SignInErrorCode
}
/** Browser destinations derived from the Host's platform configuration; never carry tokens. */
export interface AccountLinks {
  readonly usageUrl: string
  readonly topUpUrl: string
}
/** Stored-account presence is not a claim that the server has validated its token. */
export interface AccountView {
  readonly status: 'signed-out' | 'credential-stored'
  readonly links: AccountLinks
  readonly attempt: SignInAttemptView | null
}

/** Platform account identifier supplied by the current-user endpoint. */
export type AccountUserId = Branded<'AccountUserId'>
/** Display identity; contacts retain Platform masking. */
export interface AccountProfile {
  readonly id: AccountUserId | null
  readonly name: string | null
  readonly contact: string | null
  /** Profile image URL supplied by Platform, absent when no picture is configured. */
  readonly avatarUrl?: string | null
}
/** Platform recharge or bonus wallet balance; decimal strings retain server precision. */
export interface AccountWallet {
  readonly currency: 'CNY' | 'USD'
  readonly balance: string
}
/** Independent query outcomes allow profile and balance failures to render separately. */
export interface AccountDetails {
  readonly profile: { readonly status: 'ready'; readonly value: AccountProfile } | { readonly status: 'failed' }
  readonly balance: { readonly status: 'ready'; readonly value: readonly AccountWallet[]; readonly bonusWallets: readonly AccountWallet[] } | { readonly status: 'failed' }
}
