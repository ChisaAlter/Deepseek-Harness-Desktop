/** Git plugin injects the split button into the trailing cluster at order 20. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { GitActionsControl } from '../src/client/GitActionsControl.tsx'
import { GitChromeRow } from '../src/client/GitChromeRow.tsx'
import type { GitChromeRowInjected } from '../src/client/GitChromeRow.tsx'
import type { GitActionsInjected } from '../src/client/GitActionsControl.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.titlebar.trailing': { kind: 'list', scope: 'root' },
      'settings.interface.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

function provideSettings(ctx: Context): void {
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false })
  ctx.provide('remote', { $on: () => () => {} })
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  provideSettings(ctx)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber }
}

describe('ui-git apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('injects git actions into shell.titlebar.trailing at order 20', async () => {
    const b = await bench()
    const entry = b.slots.entries('shell.titlebar.trailing')[0]
    expect(entry?.component).toBe(GitActionsControl)
    expect(entry?.options).toMatchObject({ id: 'git-actions', order: 20 })
    const chrome = b.slots.entries('settings.interface.item')[0]
    expect(chrome?.component).toBe(GitChromeRow)
    expect(chrome?.options).toMatchObject({ id: 'titlebar-git', order: 20 })
    const chromeInjected = (chrome?.inject as unknown as () => GitChromeRowInjected)()
    expect(chromeInjected.hooks.titlebarGit.getSnapshot()).toBe(true)
    chromeInjected.setTitlebarGit(false)
    expect(chromeInjected.hooks.titlebarGit.getSnapshot()).toBe(false)
    await b.fiber.dispose()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
  })

  it('re-registers after the declaring titlebar slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.component).toBe(GitActionsControl)
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.options).toMatchObject({
      id: 'git-actions',
      order: 20,
    })
    redeclare()
    await b.fiber.dispose()
  })

  it('binds missing-shell git fallbacks', async () => {
    const b = await bench()
    const injected = (b.slots.entries('shell.titlebar.trailing')[0]?.inject as unknown as () => GitActionsInjected)()
    await expect(injected.gitStatus('/tmp')).resolves.toBeNull()
    await expect(injected.gitFetchForStatus('/tmp')).resolves.toBeNull()
    await expect(injected.gitReadPullRequest('/tmp')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.', pr: null,
    })
    await expect(injected.gitInit('/tmp')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitCommit('/tmp', 'msg')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    expect('gitChangedFiles' in injected).toBe(false)
    await expect(injected.gitPush('/tmp')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitPull('/tmp')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitCreateChangeRequest('/tmp', { title: 't', body: '' })).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitBranchList('/tmp')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.', branches: [],
    })
    await expect(injected.gitSwitchBranch('/tmp', 'main')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitCreateBranch('/tmp', 'feature/x')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.openExternal('https://example.com')).resolves.toBe(false)
    expect(typeof injected.onGitProgress(() => {})).toBe('function')
    injected.onGitProgress(() => {})()
    expect(typeof injected.onWorkspacesChanged(() => {})).toBe('function')
    injected.onWorkspacesChanged(() => {})()
    await b.fiber.dispose()
  })
})
