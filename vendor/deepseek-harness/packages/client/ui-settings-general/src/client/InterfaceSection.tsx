/** The Interface section: one column rendering feature-owned item contributions. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './InterfaceSection.module.css'

/** Full component props: section owner share plus item render share. */
export type InterfaceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.interface.item'>

/**
 * Render the Interface section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function InterfaceSection({ renderSlot }: InterfaceSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.interface.item', {})}
    </div>
  )
}
