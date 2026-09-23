/** First-use guidance after explicit enablement, once the Host finishes inspecting its cache. */
import { useEffect } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import type { NS } from './locales.ts'

/** Registration shares for the bundle's activation guidance. */
export type VoiceSetupPromptProps = PropsRuntime<'plugins.bundle.activation'> & PropsLocale<typeof NS>
  & Pick<InjectFace<VoiceInputInjected>, 'useSpeechReadiness'>

/**
 * Offer navigation to installation without starting a download.
 * @param props - activation navigation and the shared Host readiness observer.
 * @returns the shared modal only when the selected local provider needs preparation.
 */
export function VoiceSetupPrompt({ useSpeechReadiness, onDismiss, onOpenDetails, t }: VoiceSetupPromptProps) {
  const readiness = useSpeechReadiness(value => value)
  const provider = readiness.catalog?.providers.find(item => item.id === readiness.catalog?.selection.providerId)
  const phase = readiness.connected ? provider?.preparation.phase : undefined
  const needsSetup = phase === 'unprepared' && provider?.location === 'host-local'
  useEffect(() => {
    if (phase !== undefined && phase !== 'checking' && !needsSetup) onDismiss()
  }, [phase, needsSetup, onDismiss])
  return <Modal open={needsSetup} title={t('setupPrompt.title')} closeLabel={t('cancel')} onClose={onDismiss}
    footer={<>
      <Button variant="ghost" onClick={onDismiss}>{t('setupPrompt.later')}</Button>
      <Button variant="primary" onClick={onOpenDetails}>{t('setupPrompt.open')}</Button>
    </>}>
    <p>{t('setupPrompt.body')}</p>
  </Modal>
}
