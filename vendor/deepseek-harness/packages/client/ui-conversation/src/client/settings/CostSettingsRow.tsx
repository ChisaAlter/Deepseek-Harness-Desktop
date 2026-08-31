/** Interface Settings row for the composer-dock session cost figure: the
 * independent switch sits directly below the session-stats switch, with the
 * 设置模型价格 button beside it opening the shared price panel (any model's
 * peak inputs are editable; re-checking 使用官方价格 restores the official
 * column). The cost figure itself also requires a detected DeepSeek API route
 * and never depends on the peak/valley switch. */
import { useId, useState, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import type { ComposerCatalogModel } from '../input/model-facts.ts'
import { PriceSettingsPanel } from '../PriceSettingsPanel.tsx'
import type { SessionCostPrices } from '../../submission-settings.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface CostSettingsRowInjected {
  hooks: {
    /** Persisted session-cost preference bound as useSessionCost. */
    sessionCost: SnapshotStore<boolean>
    /** Persisted per-model price record bound as useCostPrices. */
    costPrices: SnapshotStore<SessionCostPrices>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the dock paints the session cost figure. */
  setSessionCost: (value: boolean) => void
  /** Persist a new per-model price record and reprice the session. */
  setCostPrices: (prices: SessionCostPrices) => void
  /**
   * Models the resident session directories advertise (aggregate read for
   * this root-scope row), merged into the panel's dropdown.
   */
  catalogModels: () => readonly ComposerCatalogModel[]
}

/** Full Settings-row props. */
export type CostSettingsRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'conversation'>
  & InjectFace<CostSettingsRowInjected>

/**
 * Render the session-cost Switch with its price-settings entry.
 * @param props - composed Settings slot props.
 * @returns the preference row with the modal-backed price panel.
 */
/* jscpd:ignore-start */
export function CostSettingsRow({
  useSessionCost, useCostPrices, useWritable, setSessionCost, setCostPrices, catalogModels, t,
}: CostSettingsRowProps) {
  const enabled = useSessionCost(value => value)
  const prices = useCostPrices(value => value)
  const writable = useWritable(value => value)
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const title: ConversationKey = 'settings.sessionCost.title'
  const description: ConversationKey = 'settings.sessionCost.description'
  const openPrices: ConversationKey = 'settings.sessionCost.openPrices'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Button
        variant="outline"
        disabled={!writable}
        onClick={() => { setOpen(true) }}
      >
        {t(openPrices)}
      </Button>
      <Switch
        checked={enabled}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setSessionCost(event.target.checked)
        }}
      />
      <PriceSettingsPanel
        open={open}
        model={null}
        prices={prices}
        extraModels={catalogModels()}
        onClose={() => { setOpen(false) }}
        onSave={(next) => { setCostPrices(next); setOpen(false) }}
        t={t}
      />
    </div>
  )
}
/* jscpd:ignore-end */