// dsh-usage-panel · ErrorBoundary with cache recovery.
// A render crash shows the error instead of a white page, with a one-click
// "clear cached data and retry" — the v0.1.0 blind spot (no crash fallback)
// fixed by absorbing the dashboard boundary pattern (versioned cache keeps
// stale-shape data from ever reaching the UI in the first place).
import { Component, type ReactNode } from 'react'
import { clearCached } from './api.ts'
import type { I18n } from './locales.ts'
import * as React from 'react'

interface BoundaryProps {
  i18n: I18n
  children?: ReactNode
}

interface BoundaryState {
  error: string | null
}

export class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(err: unknown): BoundaryState {
    return { error: String((err as Error)?.message ?? err) }
  }

  override componentDidCatch(err: unknown): void {
    console.error('[dsh-usage-panel] render crashed:', err)
  }

  private reset = (): void => {
    clearCached()
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const t = this.props.i18n.t
    if (this.state.error !== null) {
      return (
        <div className="dsw-ust-empty">
          <div className="dsw-ust-empty-title">{t('error.title')}</div>
          <div style={{ margin: '6px 0 12px' }}>{t('error.detail', { msg: this.state.error })}</div>
          <button className="dsw-ust-refresh" onClick={this.reset}>
            {t('error.reset')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
