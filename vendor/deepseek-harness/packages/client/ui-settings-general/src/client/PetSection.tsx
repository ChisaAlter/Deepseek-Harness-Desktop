/**
 * 桌宠 settings section: the Live2D companion's appearance, behavior, and
 * integration rows inside the desktop Settings shell. All writes ride the
 * shell's `saveLive2dPetSettings` channel so the pet manager normalizes,
 * persists, and pushes to the live overlay at once.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, SettingsSelect, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { desktopShell } from './desktop-shell.ts'
import type { Live2dPetSettings, Live2dPetSettingsResult } from './desktop-shell.ts'
import css from './PetSection.module.css'

/** One catalog provider's model row, as `remote.session.modelCatalog` serves it. */
interface PetCatalogGroup {
  id: string
  name: string
  models: readonly { id: string; name: string; inputModalities?: readonly string[] }[]
}

/** Registrant-owned dependencies of {@link PetSection}. */
export interface PetSectionInjected {
  /** Read the session model catalog; the look picker lists image-capable routes. */
  modelCatalog: () => Promise<{
    ok: boolean
    value?: { groups?: readonly PetCatalogGroup[] }
    error?: { message?: string }
  }>
}

/** Props the Settings renderer binds for this section. */
export type PetSectionProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.pet.item'>
  & PropsLocale<'settings'> & InjectFace<PetSectionInjected>

const SCALE_OPTIONS = ['0.6', '0.8', '1', '1.2', '1.4', '1.6']
const OPACITY_OPTIONS = ['0.3', '0.5', '0.7', '0.85', '1']
const PERSONALITY_OPTIONS = [
  ['natural', 'pet.personality.natural'],
  ['genki', 'pet.personality.genki'],
  ['tsundere', 'pet.personality.tsundere'],
  ['poison', 'pet.personality.poison'],
] as const
const ACTIVITY_OPTIONS = [
  ['quiet', 'pet.activity.quiet'],
  ['balanced', 'pet.activity.balanced'],
  ['active', 'pet.activity.active'],
] as const
const TOGGLE_ROWS = [
  ['powerSave', 'pet.powerSave'],
  ['clickSound', 'pet.clickSound'],
] as const
const DRAG_OPTIONS = [
  ['free', 'pet.dragFree'],
  ['shift', 'pet.dragShift'],
  ['locked', 'pet.dragLocked'],
] as const

/** One image-capable catalog route flattened for the look picker. */
interface LookRoute {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/** '\n' cannot appear in either id, so it is the stable route separator. */
function routeId(provider: string, model: string): string {
  return `${provider}\n${model}`
}

/** Flat Setting-Cell row: title (+ optional desc) left, control right. */
function Row({ title, desc, children }: {
  title: string
  desc?: string | undefined
  children?: ReactNode
}): ReactNode {
  return (
    <div className={css.item}>
      <div className={css.itemText}>
        <div className={css.itemTitle}>{title}</div>
        {desc ? <div className={css.itemDesc} title={desc}>{desc}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** Render the 桌宠 column: every control writes through on change. */
export function PetSection({ t, modelCatalog, renderSlot }: PetSectionProps): ReactNode {
  const shell = desktopShell()
  const [enabled, setEnabled] = useState(true)
  const [settings, setSettings] = useState<Live2dPetSettings>({})
  const [whaleAssistant, setWhaleAssistant] = useState(false)
  const [lookRoutes, setLookRoutes] = useState<readonly LookRoute[] | undefined>(undefined)
  const [lookLoadError, setLookLoadError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void shell?.getConfig?.().then((config) => {
      if (cancelled) return
      setEnabled(config?.live2dPet?.enabled !== false)
      setSettings(config?.live2dPet?.settings ?? {})
      setWhaleAssistant(config?.whaleAssistantEnabled === true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shell])

  // The look picker rides the session model catalog — the same source the
  // Models section's vision picker filters on 'image'.
  useEffect(() => {
    if (typeof modelCatalog !== 'function') return
    let cancelled = false
    void modelCatalog().then((res) => {
      if (cancelled) return
      if (!res?.ok || !res.value) {
        setLookLoadError(res?.error?.message || 'failed')
        return
      }
      setLookRoutes((res.value.groups ?? []).flatMap(group => group.models
        .filter(model => model.inputModalities?.includes('image') === true)
        .map(model => ({
          provider: group.id,
          providerName: group.name,
          model: model.id,
          modelName: model.name,
        }))))
    }).catch((err: unknown) => {
      if (!cancelled) setLookLoadError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [modelCatalog])

  // Every write returns the normalized settings — the local echo comes from
  // the same object the pet window just received.
  const save = useCallback(async (body: {
    enabled?: boolean
    patch?: Live2dPetSettings
    reset?: boolean
  }): Promise<Live2dPetSettingsResult | undefined> => {
    if (!shell?.saveLive2dPetSettings) return undefined
    try {
      const res = await shell.saveLive2dPetSettings(body)
      if (res?.ok === true) {
        setError('')
        if (typeof res.enabled === 'boolean') setEnabled(res.enabled)
        if (res.settings) setSettings(res.settings)
      } else {
        setError(res?.reason || 'failed')
      }
      return res
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    }
  }, [shell])

  const patch = useCallback((next: Live2dPetSettings) => {
    setSettings(prev => ({ ...prev, ...next }))
    void save({ patch: next })
  }, [save])

  // Select commits the whole route (provider + model) so the stored pick
  // round-trips exactly; 'off' clears both fields.
  const onLookChange = useCallback((id: string) => {
    if (id === '') {
      patch({ lookModel: '', lookProvider: '' })
      return
    }
    const [provider = '', model = ''] = id.split('\n')
    if (model === '') return // stale-route sentinel — display only
    patch({ lookModel: model, lookProvider: provider })
  }, [patch])

  const lookModel = settings.lookModel ?? ''
  const lookProvider = settings.lookProvider ?? ''
  const known = lookRoutes ?? []
  let lookValue = ''
  if (lookModel !== '') {
    if (lookProvider !== '') {
      lookValue = routeId(lookProvider, lookModel)
    } else {
      // A provider-less stored model (legacy or hand-written config) adopts
      // the route when exactly one catalog group offers it.
      const matches = known.filter(route => route.model === lookModel)
      const only = matches.length === 1 ? matches[0] : undefined
      if (only !== undefined) lookValue = routeId(only.provider, only.model)
    }
  }
  const stale = lookModel !== ''
    && !known.some(route => routeId(route.provider, route.model) === lookValue)
    ? {
      id: lookValue === '' ? `\n${lookModel}` : lookValue,
      label: lookProvider === '' ? lookModel : `${lookProvider} / ${lookModel}`,
    }
    : undefined
  const lookCurrent = lookValue === '' && stale !== undefined ? stale.id : lookValue

  const toggleWhale = useCallback((next: boolean) => {
    setWhaleAssistant(next)
    void shell?.saveConfig?.({ whaleAssistantEnabled: next }).catch(() => {})
  }, [shell])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('pet.nav')}</h2>
      <p className={css.intro}>{t('pet.intro')}</p>
      <div className={css.form}>
        <Row title={t('pet.enabled')} desc={t('pet.enabledDesc')}>
          <Switch
            label={t('pet.enabled')}
            checked={enabled}
            onChange={(next: boolean) => { setEnabled(next); void save({ enabled: next }) }}
          />
        </Row>

        <div className={css.group}>{t('pet.group.look')}</div>
        <Row title={t('pet.scaleOpacity')}>
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.scale')}
            value={String(settings.scale ?? 1)}
            options={SCALE_OPTIONS.map(v => ({ id: v, label: `${Math.round(Number(v) * 100)}%` }))}
            onChange={(id) => patch({ scale: Number(id) })}
          />
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.opacity')}
            value={String(settings.opacity ?? 1)}
            options={OPACITY_OPTIONS.map(v => ({ id: v, label: `${Math.round(Number(v) * 100)}%` }))}
            onChange={(id) => patch({ opacity: Number(id) })}
          />
        </Row>
        <Row title={t('pet.personality')} desc={t('pet.personalityDesc')}>
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.personality')}
            value={settings.personality ?? 'natural'}
            options={PERSONALITY_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
            onChange={(id) => patch({ personality: id })}
          />
        </Row>

        <div className={css.group}>{t('pet.group.behavior')}</div>
        <Row title={t('pet.activity')} desc={t('pet.activityDesc')}>
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.activity')}
            value={settings.activity ?? 'balanced'}
            options={ACTIVITY_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
            onChange={(id) => patch({ activity: id })}
          />
        </Row>
        <Row title={t('pet.autonomy')} desc={t('pet.autonomyDesc')}>
          <span className={css.miniToggle}>
            <span>{t('pet.selfTalk')}</span>
            <Switch
              label={t('pet.selfTalk')}
              checked={settings.selfTalk === true}
              onChange={(next: boolean) => patch({ selfTalk: next })}
            />
          </span>
          <span className={css.miniToggle}>
            <span>{t('pet.wander')}</span>
            <Switch
              label={t('pet.wander')}
              checked={settings.wander === true}
              onChange={(next: boolean) => patch({ wander: next })}
            />
          </span>
        </Row>
        <Row title={t('pet.dragMode')} desc={t('pet.dragModeDesc')}>
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.dragMode')}
            value={settings.lockPosition === true
              ? 'locked'
              : settings.shiftToDrag === true ? 'shift' : 'free'}
            options={DRAG_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
            onChange={(id) => patch(id === 'locked'
              ? { lockPosition: true, shiftToDrag: false }
              : id === 'shift'
                ? { lockPosition: false, shiftToDrag: true }
                : { lockPosition: false, shiftToDrag: false })}
          />
        </Row>
        {TOGGLE_ROWS.map(([key, labelKey]) => (
          <Row
            key={key}
            title={t(labelKey)}
            desc={key === 'powerSave' ? t('pet.powerSaveDesc') : undefined}
          >
            <Switch
              label={t(labelKey)}
              checked={settings[key] === true}
              onChange={(next: boolean) => patch({ [key]: next })}
            />
          </Row>
        ))}

        <div className={css.group}>{t('pet.group.link')}</div>
        <Row title={t('pet.chat')} desc={t('pet.chatDesc')}>
          <Switch
            label={t('pet.chat')}
            checked={settings.chatEnabled === true}
            onChange={(next: boolean) => patch({ chatEnabled: next })}
          />
        </Row>
        <Row title={t('pet.lookModel')} desc={t('pet.lookModelDesc')}>
          <SettingsSelect
            variant="inline"
            align="end"
            aria-label={t('pet.lookModel')}
            value={lookCurrent}
            placeholder={t('pet.lookModelOff')}
            options={[
              { id: '', label: t('pet.lookModelOff') },
              ...stale === undefined ? [] : [stale],
              ...known.map(route => ({
                id: routeId(route.provider, route.model),
                label: `${route.providerName} / ${route.modelName}`,
              })),
            ]}
            onChange={onLookChange}
          />
        </Row>
        {lookLoadError === ''
          ? null
          : <p className={css.error} role="status">{t('pet.lookModelLoadFailed', { message: lookLoadError })}</p>}

        <div className={css.group}>{t('pet.group.assistant')}</div>
        <Row title={t('pet.whaleAssistant')} desc={t('pet.whaleAssistantDesc')}>
          <Switch
            label={t('pet.whaleAssistant')}
            checked={whaleAssistant}
            onChange={toggleWhale}
          />
        </Row>
        {renderSlot('settings.pet.item', {})}

        <div className={css.actions}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void save({ reset: true })
            }}
          >
            {t('pet.reset')}
          </Button>
          {error ? <span className={css.error} role="status">{t('pet.saveError', { message: error })}</span> : null}
        </div>
      </div>
    </div>
  )
}
