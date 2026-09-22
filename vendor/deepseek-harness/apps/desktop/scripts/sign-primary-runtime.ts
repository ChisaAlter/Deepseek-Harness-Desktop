/** Sign Windows runtime code before executing it, retaining vendor signatures and fail-stop hardware protection. */
import { X509Certificate } from 'node:crypto'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createWindowsTokenSigner } from './windows-sign.mjs'
import { inspectWindowsRuntimeSignature, type WindowsRuntimeSignature } from './windows-runtime-signature.mjs'
import { failPackagingRun, recordPackagingEvent } from './packaging-run.mjs'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { smokePrimaryRuntime } from './prepare-primary-runtime.ts'

/**
 * Enumerate Windows code without following links or treating foreign .node files as PE binaries.
 * @param root - Owned, materialized runtime directory.
 * @returns Sorted real PE files; rejects links and malformed Windows executable files.
 */
export async function windowsRuntimeCode(root: string): Promise<string[]> {
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('primary runtime: expected a real directory')
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`primary runtime: directory links are not signable: ${path}`)
    if (entry.isDirectory()) { files.push(...await windowsRuntimeCode(path)); continue }
    if (!entry.isFile() || !['.exe', '.dll', '.pyd', '.node'].includes(extname(path).toLowerCase())) continue
    const file = await open(path, 'r')
    let portableExecutable = false
    let windowsCandidate = false
    try {
      const header = Buffer.alloc(64)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      windowsCandidate = bytesRead >= 2 && header.readUInt16LE(0) === 0x5a4d
      if (bytesRead === 64 && windowsCandidate) {
        const signature = Buffer.alloc(4)
        const offset = header.readUInt32LE(0x3c)
        const read = await file.read(signature, 0, 4, offset)
        portableExecutable = offset >= 64 && read.bytesRead === 4 && signature.readUInt32LE(0) === 0x4550
      }
    } finally { await file.close() }
    if (portableExecutable) files.push(path)
    else if (windowsCandidate || extname(path).toLowerCase() !== '.node') throw new Error(`primary runtime: invalid PE file: ${path}`)
  }
  return files.sort()
}

interface RuntimeSigningOptions {
  thumbprint: string
  sign: ReturnType<typeof createWindowsTokenSigner>
  inspect?: (path: string) => Promise<WindowsRuntimeSignature>
  record: (event: object) => void
  smoke: (root: string) => void
}

/**
 * Preserve valid signatures and sign only unsigned PE files before runtime execution.
 * @param root - Owned final runtime directory.
 * @param options - Supervised signer, certificate identity, audit sink and runtime check.
 * @returns Resolves only after sequential signatures, verification and execution; no retries.
 */
export async function signWindowsPrimaryRuntime(root: string, options: RuntimeSigningOptions): Promise<void> {
  const inspect = options.inspect ?? inspectWindowsRuntimeSignature
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('primary runtime: no Windows code found')
  const unsigned: string[] = []
  for (const path of files) {
    const signature = await inspect(path)
    options.record({ type: 'primary-runtime-signature', path, ...signature })
    if (signature.status === 'NotSigned') unsigned.push(path)
    else if (signature.status !== 'Valid') throw new Error(`primary runtime: refusing ${signature.status} signature: ${path}`)
  }
  options.record({ type: 'primary-runtime-signing-plan', files: files.length, unsigned: unsigned.length })
  for (const path of unsigned) {
    await options.sign({ path, hash: 'sha256', isNest: false })
    const signature = await inspect(path)
    if (signature.status !== 'Valid' || !signature.timestamped || signature.thumbprint?.toUpperCase() !== options.thumbprint.toUpperCase()) {
      throw new Error(`primary runtime: signing verification failed: ${path}`)
    }
    options.record({ type: 'primary-runtime-signature-verified', path, ...signature })
  }
  options.smoke(root)
  options.record({ type: 'primary-runtime-smoke-success' })
}

async function main(): Promise<void> {
  if (process.platform !== 'win32' || resolveDesktopBuildTarget() !== 'win-x64') throw new Error('primary runtime signing requires Windows x64')
  const runDirectory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (!runDirectory) throw new Error('primary runtime signing requires a supervised packaging run')
  await readFile(join(runDirectory, 'run.json'))
  const certificateFile = process.env.DSH_DESKTOP_WINDOWS_CER_FILE
  if (!certificateFile) throw new Error('primary runtime signing requires the configured certificate')
  const thumbprint = new X509Certificate(await readFile(certificateFile)).fingerprint.replaceAll(':', '')
  try {
    await signWindowsPrimaryRuntime(join(resolveDesktopTargetBuildPaths().runtime, 'primary-runtime'), {
      thumbprint,
      sign: createWindowsTokenSigner({ certificateFile, signTool: process.env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        keyContainer: process.env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER, tokenPin: process.env.DSH_DESKTOP_WINDOWS_TOKEN_PIN }),
      record: (event) => { recordPackagingEvent(runDirectory, event) },
      smoke: smokePrimaryRuntime,
    })
  } catch (error) {
    failPackagingRun(runDirectory, 'primary-runtime-signing-or-smoke-failed')
    throw error
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
