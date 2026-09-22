/** Test package using the published registration protocol, locale and slots. */
window.__ModuleLoader__.load({
  id: '@fixture/live-client',
  factory(require) {
    const React = require('react')
    const style = document.createElement('style')
    style.dataset.plugin = '@fixture/live-client'
    style.textContent = '[data-live-client] { color: rgb(12, 34, 56); position: absolute; bottom: 20px; right: 20px; }'
    document.head.append(style)
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const counters = document.documentElement.dataset
        counters.liveMounts = String(Number(counters.liveMounts ?? 0) + 1)
        ctx.effect(() => ctx.locale.register('fixtureLive', {
          zh: { active: '动态插件已启用', configSummary: '示例配置项', configForm: '动态插件配置', configField: '问候语', configSave: '保存' },
          en: { active: 'Live plugin enabled', configSummary: 'An example setting', configForm: 'Live plugin configuration', configField: 'Greeting', configSave: 'Save' },
        }))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'fixture-live-client', locale: 'fixtureLive',
        }, ({ t }) => React.createElement('div', { 'data-live-client': '' }, t('active'))))
        // The configuration of this bundle's one row, as the Plugins page renders it on the row's own page.
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config', key: '@fixture/live-client#fixture-live-client', locale: 'fixtureLive',
        }, ({ t, view }) => view === 'summary'
          ? t('configSummary')
          : React.createElement('form', {
            'data-live-config': '',
            'aria-label': t('configForm'),
            onSubmit: (event) => {
              event.preventDefault()
              counters.liveSaves = String(Number(counters.liveSaves ?? 0) + 1)
            },
          },
          React.createElement('label', null, t('configField'), React.createElement('input', { name: 'greeting', defaultValue: 'hello' })),
          React.createElement('button', { type: 'submit' }, t('configSave')))))
        ctx.effect(() => {
          const ping = () => { counters.liveHits = String(Number(counters.liveHits ?? 0) + 1) }
          window.addEventListener('dsh-fixture-ping', ping)
          return async () => {
            window.removeEventListener('dsh-fixture-ping', ping)
            await Promise.resolve()
            counters.liveDisposals = String(Number(counters.liveDisposals ?? 0) + 1)
          }
        })
      },
    }
  },
})
