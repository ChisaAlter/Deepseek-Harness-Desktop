/** Prepare pinned, relocatable script interpreters without installing into the build host. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../../desktop-host/src/primary-runtime.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'
import lock from './primary-runtime-lock.json' with { type: 'json' }

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * @param url - Locked archive URL.
 * @param sha256 - Expected SHA-256 digest.
 * @param cache - Download cache directory.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(url: string, sha256: string, cache: string): Promise<string> {
  const destination = join(cache, sha256)
  let bytes: Buffer
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const response = await fetch(url)
    if (!response.ok) throw new Error(`primary runtime download: ${String(response.status)} ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  writeFileSync(destination, bytes)
  return destination
}

async function pythonArchive(target: keyof typeof lock.targets, cache: string): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  return downloadPrimaryRuntimeAsset(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Desktop target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param pnpmVersion - Package-manager version copied into the payload.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(target: keyof typeof lock.targets, runtimeLock: typeof lock, pnpmVersion: string): string {
  const { pythonVersion, pythonRelease, nodeVersion, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 2, target, pythonVersion, pythonRelease, nodeVersion,
    artifact: runtimeLock.targets[target], wheels, pythonPackages, pnpm: pnpmVersion,
  })).digest('hex')
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - Desktop runtime resource directory outside ASAR.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/**
 * Materialize the selected Desktop target's primary runtime in its build resources.
 * @param options - Signed Windows packaging defers execution until its supervised signing stage.
 * @returns Resolves after materialization and, unless deferred, native-target execution checks.
 */
export async function preparePrimaryRuntime(options: { deferSmoke?: boolean } = {}): Promise<void> {
  const target = resolveDesktopBuildTarget()
  const paths = resolveDesktopTargetBuildPaths()
  const artifact = lock.targets[target]
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    const nodeFilename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
    const nodeArchive = await downloadPrimaryRuntimeAsset(`https://nodejs.org/dist/v${lock.nodeVersion}/${nodeFilename}`, artifact.nodeSha256, paths.downloads)
    const unpackedNode = join(staging, 'node')
    mkdirSync(unpackedNode)
    if (target === 'win-x64') await extractZip(nodeArchive, { dir: unpackedNode })
    else await extractTar({ file: nodeArchive, cwd: unpackedNode })
    const nodeSource = join(unpackedNode, nodeFilename.replace(/\.(?:zip|tar\.gz)$/u, ''))
    mkdirSync(join(dependencies, 'node', 'bin'), { recursive: true })
    mkdirSync(join(dependencies, 'node', 'node_modules'))
    writeFileSync(join(dependencies, 'node', 'node_modules', 'README.txt'), 'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
    cpSync(join(nodeSource, ...(target === 'win-x64' ? ['node.exe'] : ['bin', 'node'])),
      join(dependencies, 'node', 'bin', target === 'win-x64' ? 'node.exe' : 'node'))
    cpSync(join(nodeSource, 'LICENSE'), join(dependencies, 'node', 'LICENSE'))
    await extractTar({ file: await pythonArchive(target, paths.downloads), cwd: dependencies })
    const require = createRequire(import.meta.url)
    const pnpmManifest = require.resolve('pnpm')
    const pnpm = JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }
    await cp(dirname(pnpmManifest), join(dependencies, 'pnpm'), { recursive: true, dereference: true })
    const desktop = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: desktop.version,
      platform: target === 'win-x64' ? 'win32' : 'darwin',
      arch: target === 'mac-arm64' ? 'arm64' : 'x64',
      payloadDigest: primaryRuntimePayloadDigest(target, lock, pnpm.version),
      pythonPackages: lock.pythonPackages,
      components: {
        python: lock.pythonVersion, node: lock.nodeVersion, pnpm: pnpm.version,
        numpy: lock.pythonPackages.numpy, pandas: lock.pythonPackages.pandas,
      },
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const wheel of [...artifact.wheels, ...lock.wheels]) {
      await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads), entries.pythonPackages)
    }
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    await cp(output, destination, { recursive: true, dereference: true })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const hostRequire = createRequire(resolve(import.meta.dirname, '..', '..', 'desktop-host', 'package.json'))
  await prepareOfficeSkillAssets(join(dirname(hostRequire.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'),
    join(paths.runtime, 'office-skills'))
  if (!options.deferSmoke) smokePrimaryRuntime(join(paths.runtime, 'primary-runtime'))
}

/**
 * Execute the native payload's interpreters, package manager and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 */
export function smokePrimaryRuntime(root: string): void {
  const manifest = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')) as PrimaryRuntimeManifest
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (manifest.pythonPackages === undefined) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  const options = { stdio: 'inherit', timeout: 120_000, env: scrubWindowsSigningEnvironment(process.env) } as const
  execFileSync(entries.python, ['-I', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], options)
  execFileSync(entries.python, ['-I', '-B', join(import.meta.dirname, 'smoke-primary-runtime.py'), JSON.stringify(manifest.pythonPackages),
    manifest.components.python, join(dirname(root), 'office-skills', 'scripts', 'check_office.py')], options)
  execFileSync(entries.python, ['-I', '-B', '-m', 'pip', 'check'], options)
  execFileSync(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.components.node)}) process.exit(1)`], options)
  execFileSync(entries.node, [entries.pnpm, '--version'], options)
}

if (import.meta.main) await preparePrimaryRuntime()
