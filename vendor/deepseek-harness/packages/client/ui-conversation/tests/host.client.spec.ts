import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  CONVERSATION_SETTINGS_NAMESPACE, CUSTOM_INSTRUCTIONS_MAX_LENGTH,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM,
  DEFAULT_COMPOSER_BEAM_PRESETS, DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_COMPOSER_RESIZE, DEFAULT_OFFICIAL_PEAK_VALLEY,
  DEFAULT_STATS_LINE, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE, DEFAULT_VIEW_TABS, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter, composer-beam, composer-resize, stats-line, peak-valley, typing-fx, and view-tabs preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CONVERSATION_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      composerBeam: DEFAULT_COMPOSER_BEAM,
      composerBeamPresets: DEFAULT_COMPOSER_BEAM_PRESETS,
      composerBeamStyle: DEFAULT_COMPOSER_BEAM_STYLE,
      composerResize: DEFAULT_COMPOSER_RESIZE,
      customInstructions: '',
      statsLine: DEFAULT_STATS_LINE,
      officialPeakValley: DEFAULT_OFFICIAL_PEAK_VALLEY,
      typingFxStyle: DEFAULT_TYPING_FX_STYLE,
      typingFxPresets: DEFAULT_TYPING_FX_PRESETS,
      viewTabs: DEFAULT_VIEW_TABS,
    })
    await ctx.settings.update(ns, {
      busyEnter: 'steer', composerBeam: false, composerResize: true,
      composerBeamStyle: { ...DEFAULT_COMPOSER_BEAM_STYLE, period: 3, hue: 45 },
      composerBeamPresets: {
        calm: { ...DEFAULT_COMPOSER_BEAM_STYLE, mode: 'lounge' },
      },
      composerResizeHeight: 160, composerResizeWidth: 480,
      customInstructions: 'Answer tersely.',
      statsLine: false, officialPeakValley: true, viewTabs: false,
      typingFx: true,
      typingFxStyle: { ...DEFAULT_TYPING_FX_STYLE, effect: 'rise', speed: 160 },
      typingFxPresets: {
        quiet: { ...DEFAULT_TYPING_FX_STYLE, effect: 'flash' },
      },
    })
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: 'steer', composerBeam: false, composerResize: true,
      composerBeamStyle: { ...DEFAULT_COMPOSER_BEAM_STYLE, period: 3, hue: 45 },
      composerBeamPresets: {
        calm: { ...DEFAULT_COMPOSER_BEAM_STYLE, mode: 'lounge' },
      },
      composerResizeHeight: 160, composerResizeWidth: 480,
      customInstructions: 'Answer tersely.',
      statsLine: false, officialPeakValley: true, viewTabs: false,
      typingFx: true,
      typingFxStyle: { ...DEFAULT_TYPING_FX_STYLE, effect: 'rise', speed: 160 },
      typingFxPresets: {
        quiet: { ...DEFAULT_TYPING_FX_STYLE, effect: 'flash' },
      },
    })
    await ctx.settings.update(ns, {
      composerBeamStyle: {
        direction: 'clockwise', period: 1.96, intensity: 100, bloom: 100, hue: 0,
      } as never,
    })
    expect(ctx.settings.get(ns)).toMatchObject({
      composerBeamStyle: {
        ...DEFAULT_COMPOSER_BEAM_STYLE,
        direction: 'clockwise', period: 1.96, intensity: 100, bloom: 100, hue: 0,
      },
    })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerBeam: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerBeamStyle: { ...DEFAULT_COMPOSER_BEAM_STYLE, period: 99 } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerBeamStyle: { ...DEFAULT_COMPOSER_BEAM_STYLE, direction: 'sideways' } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerBeamStyle: { ...DEFAULT_COMPOSER_BEAM_STYLE, trackWidth: 9 } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, {
      composerBeamPresets: { broken: { ...DEFAULT_COMPOSER_BEAM_STYLE, palette: { kind: 'custom', colors: ['#fff'] } } },
    })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResize: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResizeHeight: 'tall' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResizeWidth: 'wide' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { statsLine: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { officialPeakValley: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { typingFx: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { typingFxStyle: { ...DEFAULT_TYPING_FX_STYLE, effect: 'explode' } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { typingFxStyle: { ...DEFAULT_TYPING_FX_STYLE, speed: 999 } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, {
      typingFxPresets: { broken: { ...DEFAULT_TYPING_FX_STYLE, cursor: 'cross' } },
    })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { viewTabs: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { customInstructions: 42 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, {
      customInstructions: 'x'.repeat(CUSTOM_INSTRUCTIONS_MAX_LENGTH + 1),
    })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('appends configured custom instructions to every assembled prompt and drops them when empty', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CONVERSATION_SETTINGS_NAMESPACE
    const prompt = ctx.systemPrompt

    let rendered = renderPrompt(await prompt.assemble())
    expect(rendered).not.toContain('custom instructions')

    await ctx.settings.update(ns, { customInstructions: 'Always answer tersely.' })
    rendered = renderPrompt(await prompt.assemble())
    expect(rendered).toContain('Always answer tersely.')

    // The user text rides a prompt variable, so brace groups inside it are
    // substituted verbatim instead of failing strict section interpolation.
    await ctx.settings.update(ns, { customInstructions: 'Emit {{tone}} literally.' })
    rendered = renderPrompt(await prompt.assemble())
    expect(rendered).toContain('Emit {{tone}} literally.')

    await ctx.settings.update(ns, { customInstructions: '   ' })
    rendered = renderPrompt(await prompt.assemble())
    expect(rendered).not.toContain('custom instructions')
    expect(rendered).not.toContain('Emit')

    await ctx.settings.update(ns, { customInstructions: 'Always answer tersely.' })
    await fiber.dispose()
    rendered = renderPrompt(await prompt.assemble())
    expect(rendered).not.toContain('Always answer tersely.')
  })
})
