import css from './ConnectionBanner.module.css'

/**
 * Render the reconnecting banner.
 * @param props.reconnecting - true while the connection is in backoff/retry.
 * @param props.label - banner text; the owner passes localized copy (this
 * package is cordis-free, so copy arrives via props).
 * @returns the banner, or null when connected.
 */
export function ConnectionBanner({ reconnecting, label }: {
  reconnecting: boolean
  label: string
}) {
  if (!reconnecting) return null
  return <div className={css.banner}>{label}</div>
}
