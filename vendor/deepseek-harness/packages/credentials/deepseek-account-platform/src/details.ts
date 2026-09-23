/** Platform Web profile and wallet queries projected for account UI consumers. */
import { z } from 'zod'
import type { AccountDetails, AccountProfile, AccountUserId } from '@deepseek-ai/dsh-deepseek-account/types'
import { PlatformAuthError, requestAccount } from './protocol.ts'

const user = z.object({
  id: z.string().nullish(),
  email: z.string(), mobile: z.string().optional(), mobile_number: z.string().optional(),
  id_profile: z.object({ name: z.string().nullable(), picture: z.string().nullish() }).nullish(),
})
const wallet = z.object({
  currency: z.enum(['CNY', 'USD']), balance: z.string().regex(/^-?\d+(?:\.\d+)?$/),
})
const summary = z.object({ normal_wallets: z.array(wallet), bonus_wallets: z.array(wallet) })

/** Project Platform user data without retaining credentials or unneeded fields.
 * @param value - current or exchange user response.
 * @returns UI account profile.
 */
export function profile(value: unknown): AccountProfile {
  const parsed = user.safeParse(value)
  if (!parsed.success) throw new PlatformAuthError('protocol')
  const { email, mobile, mobile_number: mobileNumber, id_profile: identity } = parsed.data
  return {
    id: parsed.data.id == null ? null : parsed.data.id as AccountUserId,
    avatarUrl: identity?.picture || null,
    name: identity?.name || null, contact: mobile || mobileNumber || email || null,
  }
}

const queries: { [K in keyof AccountDetails]: {
  path: '/auth-api/v0/users/current' | '/api/v0/users/get_user_summary'
  parse: (value: unknown) => AccountDetails[K]
} } = {
  profile: { path: '/auth-api/v0/users/current', parse: value => ({ status: 'ready', value: profile(value) }) },
  balance: { path: '/api/v0/users/get_user_summary', parse: (value) => {
    const parsed = summary.safeParse(value)
    if (!parsed.success) throw new PlatformAuthError('protocol')
    return { status: 'ready', value: parsed.data.normal_wallets, bonusWallets: parsed.data.bonus_wallets }
  } },
}

/**
 * Read one Platform account field without waiting for the other query.
 * @param field - profile or recharge and bonus wallet balances.
 * @param origin - configured origin matching the stored grant issuer.
 * @param token - stored authorization token; response tokens are discarded.
 * @param signal - request and credential lifetime.
 * @param headers - validated deployment headers for the configured origin.
 * @returns sanitized query outcome; failure never becomes a zero balance.
 */
export async function readAccountDetail<K extends keyof AccountDetails>(field: K, origin: string, token: string,
  signal: AbortSignal, headers: Record<string, string>): Promise<AccountDetails[K]> {
  const query = queries[field]
  try { return query.parse(await requestAccount(origin, query.path, token, signal, headers)) }
  catch { return { status: 'failed' } }
}
