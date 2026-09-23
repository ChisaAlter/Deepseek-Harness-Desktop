import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { expect, it, onTestFinished } from 'vitest'
import { harness, declare } from './harness.ts'
import { auditRows, mountPreset, livePresetMounts } from '../src/mount.ts'
import { mountedCompositionRows } from '../src/composition-inventory.ts'

it('preserves individual causes of import and plugin failures', async () => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.loader.builtins.stringFailure = () => { throw 'string rejection' }
  ctx.loader.builtins.aggregateFailure = () => {
    throw new AggregateError([
      new Error('first member'),
      new Error('wrapped member', { cause: new AggregateError(['nested member'], 'nested aggregate') }),
    ], 'aggregate rejection')
  }
  await ctx.loader.root.update([
    { id: 'missing', name: 'cordis:missingBuiltin' },
    { id: 'disabled', name: 'cordis:missingBuiltin', disabled: true },
    { id: 'string', name: 'cordis:stringFailure' },
    { id: 'aggregate', name: 'cordis:aggregateFailure' },
  ])
  expect(await auditRows(ctx.loader)).toEqual({ failed: [
    'missing (cordis:missingBuiltin): never started',
    'string (cordis:stringFailure): string rejection',
    'aggregate (cordis:aggregateFailure): aggregate rejection\n- first member\n- wrapped member\n  - nested member',
  ], pending: [] })
  await expect(mountPreset(ctx, 'unscoped', [])).rejects.toThrow('requires a scope')
})

it('does not replace the declaring Loader entry subtree or persist runtime tree changes', async () => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  const scopes: ReturnType<typeof createScope>[] = []
  ctx.loader.builtins.parent = { inject: ['loader'], async apply(owner: Context) {
    const entry = owner.fiber.entry!
    const previousTree = entry.subtree
    const previousGroup = entry.subgroup
    const scope = createScope(owner, {})
    scopes.push(scope)
    const mount = await mountPreset(scope.ctx, 'owned', [{ id: 'child', name: 'missing', disabled: true }])
    expect([...mount.tree.entries()][0]!.id).toBe('parent:child')
    expect(mountedCompositionRows(mount.tree)[0]!.entryId).toBe('child')
    expect(entry.subtree).toBe(previousTree)
    expect(entry.subgroup).toBe(previousGroup)
    mount.tree.write()
    entry.subtree = mount.tree
    entry.subgroup = mount.tree.root
    const other = createScope(owner, {})
    scopes.push(other)
    await mountPreset(other.ctx, 'owned-again', [])
    expect(entry.subtree).toBe(mount.tree)
    expect(entry.subgroup).toBe(mount.tree.root)
    delete entry.subtree
    delete entry.subgroup
  } }
  await ctx.loader.root.update([{ id: 'parent', name: 'cordis:parent' }])
  expect(await auditRows(ctx.loader)).toEqual({ failed: [], pending: [] })
  expect(scopes).toHaveLength(2)
  for (const scope of scopes) await scope.dispose()
})

it('reports grouped and conditional plugin rows from the activated tree', async () => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  await declare(ctx, { id: 'standard', plugins: [{ name: 'cordis:group', group: true, config: [
    { id: 'off', name: 'missing', disabled: { __jsExpr: 'true' } },
  ] }] })
  const tree = livePresetMounts(ctx.fiber)[0]!.tree
  expect(mountedCompositionRows(tree)).toEqual([{ entryId: 'off', moduleName: 'missing', enabled: false, condition: 'true' }])
})
