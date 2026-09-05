import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Input,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  InstalledPlugin,
  MarketCatalog,
  MarketItem,
  PluginOpResult,
  PluginProgress,
} from './desktop-shell.ts'
import { specMatchesOwnerRepo } from './spec-match.ts'
import css from './MarketSection.module.css'

/** Registration-side desktop callbacks used by the marketplace section. */
export interface MarketSectionInjected {
  /** Read the curated catalog (localized main-process payload). */
  listCatalog: (options?: { refresh?: boolean }) => Promise<MarketCatalog>
  /** Read the profile's installed-plugin rows. */
  listInstalled: () => Promise<InstalledPlugin[]>
  /** Install one catalog row by registry id; the engine restarts Harness. */
  install: (id: string, options?: { allowBuilds?: string[] }) => Promise<PluginOpResult>
  /** Uninstall one installed package by name; the engine restarts Harness. */
  uninstall: (name: string) => Promise<PluginOpResult>
  /** Subscribe to install/uninstall/restart progress lines. */
  onProgress: (listener: (payload: PluginProgress) => void) => () => void
}

/** Full component props assembled by the Settings section slot. */
export type MarketSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.market'>
  & InjectFace<MarketSectionInjected>

type CatalogState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  /** `refreshFailed` keeps the shown catalog when a later reload throws. */
  | { readonly status: 'ready'; readonly catalog: MarketCatalog; readonly refreshFailed?: boolean }

type Tab = 'discover' | 'installed'

type BusyOp = { kind: 'install' | 'uninstall'; id: string } | null

type Notice = { kind: 'ok' | 'error'; text: string } | null

type AllowBuildsAsk = { item: MarketItem; keys: string[] } | null

const PROGRESS_LINES = 6

/**
 * Discover cards rendered per page. The curated registry carries thousands of
 * rows; mounting them all at once stalls the settings panel, so the pane
 * renders one page and grows on demand through the show-more button.
 */
export const DISCOVER_PAGE_SIZE = 60

/** The installed package name backing one catalog row, or null. */
function installedNameFor(item: MarketItem, plugins: InstalledPlugin[]): string | null {
  if (item.packageName && plugins.some(row => row.name === item.packageName)) {
    return item.packageName
  }
  const bySpec = plugins.find(row => specMatchesOwnerRepo(row.spec, item.owner, item.repo))
  return bySpec ? bySpec.name : null
}

/** The catalog row backing one installed plugin, or null when uncatalogued. */
function catalogItemFor(plugin: InstalledPlugin, items: MarketItem[]): MarketItem | null {
  const byName = items.find(item => item.packageName === plugin.name)
  if (byName) return byName
  return items.find(item => specMatchesOwnerRepo(plugin.spec, item.owner, item.repo)) ?? null
}

/**
 * Whether a not-yet-installed catalog row may offer its Install button:
 * deprecated rows and rows whose desktop engine resolved no install spec
 * get no install path from the card (parity: 空 `installSpec` 的卡片不提供
 * 安装按钮), matching the main-process gate that rejects them anyway.
 */
function installable(item: MarketItem): boolean {
  return item.deprecated !== true && item.installSpec.trim().length > 0
}

/** Whether one catalog row matches the local search query. */
function matches(item: MarketItem, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [item.id, item.description, item.packageName]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/**
 * Plugin owner's GitHub avatar (no API call, browser-cached), falling back
 * to an initial-letter tile when the image cannot load.
 * @param props.owner - GitHub owner login; empty skips the network image.
 * @param props.repo - repository name feeding the fallback initial.
 * @returns a 16px decorative avatar node.
 */
function OwnerAvatar({ owner, repo }: { owner: string; repo: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed || owner === '') {
    return (
      <span className={css.avatarFallback} aria-hidden="true">
        {(repo.replace(/^dsh[-_]/i, '').charAt(0) || 'P').toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className={css.avatar}
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=96`}
      alt=""
      loading="lazy"
      onError={() => { setFailed(true) }}
    />
  )
}

/** One installed-pane group: a localized category heading plus its rows. */
type InstalledGroup = {
  key: string
  label: string
  rows: { plugin: InstalledPlugin; item: MarketItem | null }[]
}

/**
 * Group installed rows by their catalog category, keeping catalog order;
 * rows without a catalog match land in a trailing ungrouped section.
 */
function installedGroups(
  plugins: InstalledPlugin[],
  catalog: MarketCatalog,
  ungroupedLabel: string,
): InstalledGroup[] {
  const categories = catalog.categories.filter(row => row.id !== 'all')
  const rows = plugins.map(plugin => ({ plugin, item: catalogItemFor(plugin, catalog.items) }))
  const groups: InstalledGroup[] = []
  for (const category of categories) {
    const members = rows.filter(row => row.item !== null && row.item.category === category.id)
    if (members.length > 0) groups.push({ key: category.id, label: category.label, rows: members })
  }
  const grouped = new Set(groups.flatMap(group => group.rows.map(row => row.plugin.name)))
  const rest = rows.filter(row => !grouped.has(row.plugin.name))
  if (rest.length > 0) groups.push({ key: 'ungrouped', label: ungroupedLabel, rows: rest })
  return groups
}

/**
 * Marketplace settings section: a Discover tab (curated catalog browse/search
 * with per-card install) and an Installed tab (profile rows grouped by catalog
 * category with uninstall), plus allow-builds approval and progress lines.
 * All engine work happens in the desktop main process behind the injected
 * callbacks.
 * @param props - composed slot props plus the desktop inject face.
 * @returns the section content.
 */
export function MarketSection({
  t,
  listCatalog,
  listInstalled,
  install,
  uninstall,
  onProgress,
}: MarketSectionProps): ReactNode {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [reloading, setReloading] = useState(false)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [tab, setTab] = useState<Tab>('discover')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [visibleCount, setVisibleCount] = useState(DISCOVER_PAGE_SIZE)
  const [busy, setBusy] = useState<BusyOp>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [ask, setAsk] = useState<AllowBuildsAsk>(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  const reloadInstalled = useCallback(async () => {
    try {
      const plugins = await listInstalled()
      if (alive.current) setInstalled(plugins)
    } catch {
      // The installed list is a secondary annotation; the catalog stays usable.
    }
  }, [listInstalled])

  const load = useCallback(async (refresh: boolean) => {
    setReloading(true)
    setState(current => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      const catalog = await listCatalog(refresh ? { refresh: true } : undefined)
      if (alive.current) setState({ status: 'ready', catalog })
    } catch {
      // A failed reload keeps the shown catalog (per the marketplace failure
      // conventions); only the first load may land on the bare error state.
      if (alive.current) {
        setState(current => (current.status === 'ready'
          ? { ...current, refreshFailed: true }
          : { status: 'error' }))
      }
    } finally {
      if (alive.current) setReloading(false)
    }
    void reloadInstalled()
  }, [listCatalog, reloadInstalled])

  useEffect(() => { void load(false) }, [load])

  const runOp = useCallback(async (
    op: BusyOp & object,
    work: () => Promise<PluginOpResult>,
    doneText: string,
  ) => {
    setBusy(op)
    setNotice(null)
    setAsk(null)
    setProgress([])
    const off = onProgress((payload) => {
      if (!alive.current) return
      const line = payload.phase === 'restart' ? t('restarting') : payload.line
      if (!line) return
      setProgress(current => [...current.slice(-(PROGRESS_LINES - 1)), line])
    })
    try {
      const result = await work()
      if (!alive.current) return
      if (result.ok) {
        setNotice(result.harnessStarted === false
          ? { kind: 'error', text: result.error || t('harnessDown') }
          : { kind: 'ok', text: doneText })
      } else if (result.needsAllowBuilds && op.kind === 'install') {
        const item = state.status === 'ready'
          ? state.catalog.items.find(row => row.id === op.id) ?? null
          : null
        const keys = result.allowBuilds ?? []
        if (item && keys.length > 0) setAsk({ item, keys })
        else setNotice({ kind: 'error', text: t('opFailed', { message: result.error || 'allowBuilds' }) })
      } else {
        setNotice({ kind: 'error', text: t('opFailed', { message: result.error || 'unknown' }) })
      }
    } catch (caught) {
      if (alive.current) {
        setNotice({ kind: 'error', text: t('opFailed', { message: caught instanceof Error ? caught.message : String(caught) }) })
      }
    } finally {
      off()
      if (alive.current) {
        setBusy(null)
        setProgress([])
        void reloadInstalled()
      }
    }
  }, [onProgress, reloadInstalled, state, t])

  const startInstall = useCallback((item: MarketItem, allowBuilds?: string[]) => {
    void runOp(
      { kind: 'install', id: item.id },
      () => install(item.id, allowBuilds && allowBuilds.length > 0 ? { allowBuilds } : undefined),
      t('installDone'),
    )
  }, [install, runOp, t])

  const startUninstall = useCallback((opId: string, name: string) => {
    void runOp({ kind: 'uninstall', id: opId }, () => uninstall(name), t('uninstallDone'))
  }, [runOp, t, uninstall])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const items = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.catalog.items.filter(item => (
      (category === 'all' || item.category === category) && matches(item, normalizedQuery)
    ))
  }, [category, normalizedQuery, state])

  // A new search or category always starts back at the first page.
  useEffect(() => {
    setVisibleCount(DISCOVER_PAGE_SIZE)
  }, [category, normalizedQuery])

  const visibleItems = items.length > visibleCount ? items.slice(0, visibleCount) : items
  const hiddenCount = items.length - visibleItems.length

  const categoryLabels = useMemo(() => {
    if (state.status !== 'ready') return new Map<string, string>()
    return new Map(state.catalog.categories.map(row => [row.id, row.label]))
  }, [state])

  const groups = useMemo(() => (
    state.status === 'ready' ? installedGroups(installed, state.catalog, t('ungrouped')) : []
  ), [installed, state, t])

  const isBusy = busy !== null
  const installedTabLabel = installed.length > 0
    ? `${t('tabInstalled')} (${installed.length})`
    : t('tabInstalled')

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      <header className={css.heading}>
        <div className={css.headingText}>
          <h2 className={css.title}>{t('heading')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.headingActions}>
          <Button
            size="sm"
            variant="outline"
            className={css.iconAction}
            icon={<IconRefreshOutline16 />}
            aria-label={reloading ? t('refreshing') : t('refresh')}
            title={reloading ? t('refreshing') : t('refresh')}
            disabled={isBusy || reloading}
            onClick={() => { void load(true) }}
          />
        </div>
      </header>
      {state.status === 'loading' ? <p className={css.status} role="status">{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.loadFailure}>
          <p role="alert">{t('loadError')}</p>
          <Button size="sm" variant="outline" onClick={() => { void load(true) }}>{t('retry')}</Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.refreshFailed ? (
            <div className={css.loadFailure}>
              <p role="alert">{t('loadError')}</p>
              <Button size="sm" variant="outline" onClick={() => { void load(true) }}>{t('retry')}</Button>
            </div>
          ) : null}
          <div className={css.tabs} role="tablist" aria-label={t('heading')}>
            <Pill
              role="tab"
              id="market-tab-discover"
              aria-selected={tab === 'discover'}
              aria-controls="market-panel-discover"
              active={tab === 'discover'}
              onClick={() => { setTab('discover') }}
            >
              {t('tabDiscover')}
            </Pill>
            <Pill
              role="tab"
              id="market-tab-installed"
              aria-selected={tab === 'installed'}
              aria-controls="market-panel-installed"
              active={tab === 'installed'}
              onClick={() => { setTab('installed') }}
            >
              {installedTabLabel}
            </Pill>
          </div>
          {notice ? (
            <p
              className={css.notice}
              data-kind={notice.kind}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.text}
            </p>
          ) : null}
          {ask ? (
            <div className={css.allowBuilds} role="alertdialog" aria-label={t('allowBuildsAsk', { name: ask.item.repo })}>
              <p>{t('allowBuildsAsk', { name: ask.item.repo })}</p>
              {ask.keys.length > 0 ? <code>{t('allowBuildsKeys', { keys: ask.keys.join(', ') })}</code> : null}
              <div className={css.allowBuildsActions}>
                <Button size="sm" variant="primary" onClick={() => { startInstall(ask.item, ask.keys) }}>
                  {t('allowBuildsConfirm')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAsk(null) }}>
                  {t('allowBuildsCancel')}
                </Button>
              </div>
            </div>
          ) : null}
          {busy && progress.length > 0 ? (
            <div className={css.progress} role="log" aria-label={t('progressHeading')}>
              {progress.map((line, position) => <code key={`${position}-${line}`}>{line}</code>)}
            </div>
          ) : null}
          <div
            key={tab}
            role="tabpanel"
            id={`market-panel-${tab}`}
            aria-labelledby={`market-tab-${tab}`}
            data-dsh-motion="swap"
            className={css.pane}
          >
            {tab === 'discover' ? (
              <>
                <div className={css.toolbar}>
                  <Input
                    className={css.search}
                    type="search"
                    icon={<IconSearchOutline16 />}
                    value={query}
                    placeholder={t('search')}
                    aria-label={t('search')}
                    onChange={(event) => { setQuery(event.currentTarget.value) }}
                  />
                </div>
                {state.catalog.categories.length > 1 ? (
                  <div className={css.categories} role="radiogroup" aria-label={t('categories')}>
                    {state.catalog.categories.map(row => (
                      <Pill
                        key={row.id}
                        role="radio"
                        aria-checked={category === row.id}
                        active={category === row.id}
                        onClick={() => { setCategory(row.id) }}
                      >
                        {row.label}
                        <span className={css.categoryCount}>{row.count}</span>
                      </Pill>
                    ))}
                  </div>
                ) : null}
                {state.catalog.warning ? (
                  <p className={css.warning} role="status">
                    <IconWarningOutline16 aria-hidden="true" />
                    <span>{state.catalog.warning}</span>
                  </p>
                ) : null}
                <p className={css.resultCount} data-market-count={items.length}>
                  {t('count', { count: String(items.length) })}
                </p>
                {state.catalog.items.length === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
                {state.catalog.items.length > 0 && items.length === 0
                  ? <p className={css.empty}>{t('emptySearch')}</p>
                  : null}
                {items.length > 0 ? (
                  <ul className={css.cards}>
                    {visibleItems.map((item) => {
                      const installedName = installedNameFor(item, installed)
                      const busyKind = busy !== null && busy.id === item.id ? busy.kind : null
                      return (
                        <li className={css.card} key={item.id} data-market-item={item.id}>
                          <div className={css.cardHead}>
                            <div className={css.cardIdentity}>
                              <span className={css.cardTitleRow}>
                                <strong className={css.cardTitle} title={item.id}>{item.repo}</strong>
                                {item.deprecated ? <span className={css.deprecatedTag}>{t('deprecated')}</span> : null}
                              </span>
                              <span className={css.cardByline}>
                                <OwnerAvatar owner={item.owner} repo={item.repo} />
                                <span className={css.cardOwner}>{item.owner}</span>
                                {item.stars > 0 ? (
                                  <span className={css.cardStars} title={t('stars', { count: String(item.stars) })}>
                                    ★ {item.stars}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                            {item.homepage ? (
                              <a
                                className={css.cardLink}
                                href={item.homepage}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t('homepage')}
                                title={t('homepage')}
                              >
                                <IconRightUpOutline16 />
                              </a>
                            ) : null}
                          </div>
                          <p className={css.cardDescription}>{item.description}</p>
                          <div className={css.cardFoot}>
                            {item.category ? (
                              <Pill className={css.categoryTag}>
                                {categoryLabels.get(item.category) ?? item.category}
                              </Pill>
                            ) : null}
                            <span className={css.grow} />
                            {installedName ? (
                              <>
                                <span className={css.installedTag}>{t('installed')}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  onClick={() => { startUninstall(item.id, installedName) }}
                                >
                                  {busyKind === 'uninstall' ? t('uninstalling') : t('uninstall')}
                                </Button>
                              </>
                            ) : installable(item) ? (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={isBusy}
                                onClick={() => { startInstall(item) }}
                              >
                                {busyKind === 'install' ? t('installing') : t('install')}
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {hiddenCount > 0 ? (
                  <div className={css.showMore}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setVisibleCount(current => current + DISCOVER_PAGE_SIZE) }}
                    >
                      {t('showMore', { count: String(hiddenCount) })}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {installed.length === 0 ? (
                  <p className={css.empty}>{t('installedEmpty')}</p>
                ) : (
                  groups.map(group => (
                    <section key={group.key} className={css.installedGroup} aria-label={group.label}>
                      <h3 className={css.groupTitle}>{group.label}</h3>
                      <ul className={css.installedRows}>
                        {group.rows.map(({ plugin, item }) => {
                          const opId = item ? item.id : plugin.name
                          return (
                            <li className={css.installedRow} key={plugin.name}>
                              <div className={css.installedIdentity}>
                                <span className={css.installedName}>
                                  {plugin.name}
                                  {plugin.dropped ? <span className={css.deprecatedTag}>{t('dropped')}</span> : null}
                                </span>
                                <code className={css.installedSpec}>{plugin.spec}</code>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isBusy}
                                onClick={() => { startUninstall(opId, plugin.name) }}
                              >
                                {busy?.kind === 'uninstall' && busy.id === opId ? t('uninstalling') : t('uninstall')}
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))
                )}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
