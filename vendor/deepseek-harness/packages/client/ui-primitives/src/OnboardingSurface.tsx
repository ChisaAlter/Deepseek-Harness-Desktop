import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from './usePresence.ts'
import css from './OnboardingSurface.module.css'

/**
 * Render a body-portaled onboarding stage and keep the application root inert
 * while mounted.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the body-portaled overlay tree.
 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  const { state } = usePresence(true)

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    appRoot.inert = true
    return () => { appRoot.inert = false }
  }, [])

  return createPortal((
    <div className={css.onboardingOverlay} role="presentation" data-dsh-motion="overlay" data-state={state}>
      <div className={css.onboardingMask} data-dsh-motion-part="mask" aria-hidden="true" />
      <div className={css.onboardingStage} data-dsh-motion-part="panel">{children}</div>
    </div>
  ), document.body)
}
