/** Inspect runtime signatures and preserve byte-identical copies made by electron-builder. */
import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'
import { recordPackagingEvent } from './packaging-run.mjs'

/**
 * Read Windows trust, timestamp and signer identity using the engine's bundled modules, without accessing the private key.
 * @param {string} path File to inspect.
 * @returns {Promise<{status: string, timestamped: boolean, thumbprint: string | null}>} Authenticode verification result.
 */
export async function inspectWindowsRuntimeSignature(path) {
  // Node can inherit PowerShell 7's module search path while launching Windows PowerShell 5.
  const { stdout, stderr } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop; $s=Get-AuthenticodeSignature -LiteralPath $env:DSH_RUNTIME_VERIFY_FILE; [pscustomobject]@{status=[string]$s.Status;timestamped=($null -ne $s.TimeStamperCertificate);thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress'], {
    env: { ...scrubWindowsSigningEnvironment(process.env), DSH_RUNTIME_VERIFY_FILE: path },
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024,
  })
  const value = JSON.parse(stdout)
  if (stderr || typeof value !== 'object' || value === null || typeof value.status !== 'string'
    || typeof value.timestamped !== 'boolean'
    || !(value.thumbprint === null || typeof value.thumbprint === 'string' && /^[A-F\d]{40}$/iu.test(value.thumbprint))) {
    throw new Error(`primary runtime: invalid signature inspection: ${path}`)
  }
  return { status: value.status, timestamped: value.timestamped, thumbprint: value.thumbprint }
}

/**
 * Preserve a copied primary-runtime executable only after signature and exact-byte verification.
 * @param {string} path Signing-hook target.
 * @param {{sourceRoot: string, destinationRoot: string, runDirectory: string, inspect?: typeof inspectWindowsRuntimeSignature}} options Prepared and copied runtime roots with retained audit directory.
 * @returns {Promise<boolean>} True for a verified runtime copy; false for targets outside that directory.
 */
export async function preserveWindowsRuntimeSignature(path, options) {
  const suffix = relative(options.destinationRoot, path)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) return false
  const source = join(options.sourceRoot, suffix)
  for (const file of [source, path]) {
    if (await realpath(file) !== resolve(file)) throw new Error(`primary runtime: linked copy is not signable: ${file}`)
  }
  const [prepared, copied] = await Promise.all([readFile(source), readFile(path)])
  if (!prepared.equals(copied)) throw new Error(`primary runtime: copied executable changed: ${path}`)
  const signature = await (options.inspect ?? inspectWindowsRuntimeSignature)(path)
  if (signature.status !== 'Valid') throw new Error(`primary runtime: copied signature is ${signature.status}: ${path}`)
  recordPackagingEvent(options.runDirectory, { type: 'primary-runtime-copy-verified', path, ...signature })
  return true
}
