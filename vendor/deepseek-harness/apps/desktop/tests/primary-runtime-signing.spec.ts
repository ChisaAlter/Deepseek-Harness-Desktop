import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { signWindowsPrimaryRuntime, windowsRuntimeCode } from '../scripts/sign-primary-runtime.ts'
import { inspectWindowsRuntimeSignature, preserveWindowsRuntimeSignature } from '../scripts/windows-runtime-signature.mjs'
import { createPackagingRun } from '../scripts/packaging-run.mjs'

const roots: string[] = []
const thumbprint = 'A'.repeat(40)
const valid = { status: 'Valid', timestamped: true, thumbprint }
const unsigned = { status: 'NotSigned', timestamped: false, thumbprint: null }

async function fixture(names = ['a.exe', 'b.pyd', 'vendor.dll']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'primary-signing-'))
  roots.push(root)
  const pe = Buffer.alloc(128)
  pe.writeUInt16LE(0x5a4d, 0)
  pe.writeUInt32LE(64, 0x3c)
  pe.writeUInt32LE(0x4550, 64)
  for (const name of names) await writeFile(join(root, name), pe)
  return root
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('selects real PE code, including .node, without signing foreign native modules or data', async () => {
  const root = await fixture(['runtime.node', 'python.exe'])
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'foreign.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  await writeFile(join(root, 'readme.txt'), 'text')
  expect(await windowsRuntimeCode(root)).toEqual([join(root, 'python.exe'), join(root, 'runtime.node')].sort())
})

it('refuses malformed executables and root or nested directory links', async () => {
  const root = await fixture([])
  const target = await fixture([])
  const link = join(root, 'linked')
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(windowsRuntimeCode(root)).rejects.toThrow('links are not signable')
  await expect(windowsRuntimeCode(link)).rejects.toThrow('real directory')
  await writeFile(join(target, 'broken.exe'), 'invalid')
  await expect(windowsRuntimeCode(target)).rejects.toThrow('invalid PE file')
  await rm(join(target, 'broken.exe'))
  await writeFile(join(target, 'broken.node'), 'MZ')
  await expect(windowsRuntimeCode(target)).rejects.toThrow('invalid PE file')
})

it('retains vendor signatures and verifies each new signature before execution', async () => {
  const root = await fixture()
  const signed = new Set<string>()
  const sequence: string[] = []
  const sign = vi.fn(async ({ path }: { path: string }) => { sequence.push(`sign:${path}`); signed.add(path) })
  const inspect = vi.fn(async (path: string) => {
    sequence.push(`inspect:${path}`)
    return path.endsWith('vendor.dll') ? { ...valid, thumbprint: 'B'.repeat(40) } : signed.has(path) ? valid : unsigned
  })
  const smoke = vi.fn(() => { sequence.push('smoke') })
  await signWindowsPrimaryRuntime(root, { sign, inspect, smoke, thumbprint, record: () => {} })
  expect(sign.mock.calls.map(([input]) => input.path)).toEqual([join(root, 'a.exe'), join(root, 'b.pyd')])
  expect(sequence).toEqual([
    ...['a.exe', 'b.pyd', 'vendor.dll'].map(name => `inspect:${join(root, name)}`),
    `sign:${join(root, 'a.exe')}`, `inspect:${join(root, 'a.exe')}`,
    `sign:${join(root, 'b.pyd')}`, `inspect:${join(root, 'b.pyd')}`, 'smoke',
  ])
  expect(smoke).toHaveBeenCalledWith(root)
})

it.each(['HashMismatch', 'NotTrusted', 'UnknownError'])('rejects existing %s signatures before any hardware call', async (status) => {
  const root = await fixture()
  const sign = vi.fn(async () => {})
  const smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint, sign, smoke, record: () => {},
    inspect: async path => path.endsWith('vendor.dll') ? { ...valid, status } : unsigned })).rejects.toThrow(status)
  expect(sign).not.toHaveBeenCalled()
  expect(smoke).not.toHaveBeenCalled()
})

it('stops immediately on signer failure without retrying, signing another file or executing it', async () => {
  const root = await fixture()
  const sign = vi.fn(async () => { throw new Error('token refused') })
  const smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint, sign, smoke, record: () => {}, inspect: async () => unsigned }))
    .rejects.toThrow('token refused')
  expect(sign).toHaveBeenCalledOnce()
  expect(smoke).not.toHaveBeenCalled()
})

it.each([
  { ...valid, timestamped: false },
  { ...valid, thumbprint: 'B'.repeat(40) },
  { ...valid, status: 'HashMismatch' },
])('refuses an unverified new signature before the next file: %j', async (invalid) => {
  const root = await fixture()
  let signed = false
  const sign = vi.fn(async () => { signed = true })
  const smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, {
    thumbprint, sign, smoke, record: () => {}, inspect: async () => signed ? invalid : unsigned,
  }))
    .rejects.toThrow('signing verification failed')
  expect(sign).toHaveBeenCalledOnce()
  expect(smoke).not.toHaveBeenCalled()
})

it('stops before hardware when the audit sink fails and never reports a failed smoke as success', async () => {
  const root = await fixture()
  const sign = vi.fn(async () => {})
  const smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint, sign, smoke, inspect: async () => unsigned,
    record: () => { throw new Error('audit unavailable') } })).rejects.toThrow('audit unavailable')
  expect(sign).not.toHaveBeenCalled()
  const record = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint, sign, inspect: async () => valid, record,
    smoke: () => { throw new Error('runtime blocked') } })).rejects.toThrow('runtime blocked')
  expect(record).not.toHaveBeenCalledWith({ type: 'primary-runtime-smoke-success' })
})

it('refuses an empty runtime without declaring successful validation', async () => {
  const root = await fixture([])
  const smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint, sign: vi.fn(), smoke, record: () => {} })).rejects.toThrow('no Windows code')
  expect(smoke).not.toHaveBeenCalled()
})

it.skipIf(process.platform !== 'win32')('reads a Windows system signature without using signing hardware', async () => {
  const signature = await inspectWindowsRuntimeSignature(join(process.env.SystemRoot!, 'System32', 'cmd.exe'))
  expect(signature.status).toBe('Valid')
  expect(signature.thumbprint).toMatch(/^[A-F\d]{40}$/iu)
}, 70_000)

it('preserves only identical, valid runtime copies and records verification without signing', async () => {
  const sourceRoot = await realpath(await fixture(['python.exe']))
  const destinationRoot = await realpath(await fixture(['python.exe']))
  const run = createPackagingRun(join(sourceRoot, 'records'), {})
  const inspect = vi.fn(async () => valid)
  const options = { sourceRoot, destinationRoot, runDirectory: run.directory, inspect }
  const path = join(destinationRoot, 'python.exe')
  expect(await preserveWindowsRuntimeSignature(join(`${destinationRoot}-other`, 'python.exe'), options)).toBe(false)
  expect(inspect).not.toHaveBeenCalled()
  expect(await preserveWindowsRuntimeSignature(path, options)).toBe(true)
  expect(await readFile(join(run.directory, 'events.jsonl'), 'utf8')).toContain('primary-runtime-copy-verified')
  inspect.mockResolvedValueOnce({ ...valid, status: 'NotSigned' })
  await expect(preserveWindowsRuntimeSignature(path, options)).rejects.toThrow('copied signature is NotSigned')
  await writeFile(path, 'changed executable')
  await expect(preserveWindowsRuntimeSignature(path, options)).rejects.toThrow('copied executable changed')
  await rm(path)
  await symlink(sourceRoot, join(destinationRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await mkdir(join(sourceRoot, 'linked'))
  await writeFile(join(sourceRoot, 'linked', 'python.exe'), await readFile(join(sourceRoot, 'python.exe')))
  await expect(preserveWindowsRuntimeSignature(join(destinationRoot, 'linked', 'python.exe'), options)).rejects.toThrow('linked copy')
})
