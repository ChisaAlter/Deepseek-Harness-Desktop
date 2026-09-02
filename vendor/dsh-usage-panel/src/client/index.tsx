// dsh-usage-panel · Client entry (web plugin `./client` export).
// Registered into the DSH browser module loader via scripts/wrap-client.mjs;
// exports.apply + exports.inject are the loader contract. The settings page
// label is a thunk so the settings list re-reads the active language; locale
// switches re-render through the i18n subscription wired to 'locale/change'.
import { createElement } from 'react'
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientCtx } from './ctx.ts'
import { createI18n } from './locales.ts'
import { CSS, STYLE_ID } from './styles.ts'
import { StatsSection } from './StatsSection.tsx'
import { CostStrip } from './CostStrip.tsx'
import { Boundary } from './boundary.tsx'
import { missingPrimitives } from './primitives.ts'
import { callBillingGet } from './api.ts'
import { publishBilling } from './billing-bus.ts'

export const inject = ['slots', 'connection', 'locale']

export function apply(ctx: ClientCtx): void {
  const gaps = missingPrimitives(uiPrimitives as Record<string, unknown>)
  if (gaps.length) {
    console.warn(
      '[dsh-usage-panel] host ui-primitives missing ' + gaps.join(', ') + ' — usage-stats section disabled',
    )
    return
  }

  // Warm the billing prefs at apply time: the settings modal and the strip
  // then render from the in-bundle snapshot the moment they open, even during
  // a cold start (a host busy with the boot fold serves them later).
  callBillingGet(ctx.connection.rpc)
    .then((settings) => publishBilling(settings))
    .catch(() => {
      /* the modal/strip retry lazily; a failed warm-up is not fatal */
    })

  let tag: HTMLStyleElement | null = null
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
    tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-usage-panel'
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  const i18n = createI18n(ctx.locale)
  const disposeLocaleEvent = ctx.on ? ctx.on('locale/change', () => i18n.update()) : null

  const slots = ctx.slots
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'usage-stats',
        order: 25,
        label: () => i18n.t('nav.label'),
      },
      () => createElement(Boundary, { i18n }, createElement(StatsSection, { rpc: ctx.connection.rpc, i18n })),
    ),
  )

  // Composer cost strip: session-scope entry of the official
  // conversation.composer.dock slot (same seat family as the stats line).
  slots.inject('conversation.composer.dock', () =>
    slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'usage-cost',
        order: 4,
      },
      (props?: unknown) => {
        const sessionId = ((props ?? {}) as { sessionId?: string | null }).sessionId ?? null
        return createElement(CostStrip, { rpc: ctx.connection.rpc, i18n, sessionId })
      },
    ),
  )

  ctx.effect(() => () => {
    if (tag !== null && tag.isConnected) tag.remove()
    if (disposeLocaleEvent) disposeLocaleEvent()
    i18n.dispose()
  })
}
