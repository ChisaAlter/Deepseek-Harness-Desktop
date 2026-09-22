/** Select the single LibreOffice payload from the kit's declared native targets. */

/**
 * Require a declared native target even when its optional npm package is absent.
 * Targets without a declared native engine use WASM.
 * @param manifest - Installed LibreOffice kit package manifest.
 * @param target - Node platform and architecture of the distribution.
 * @returns Engine suffix used by the kit's npm packages.
 */
export function selectOfficeEngine(
  manifest: { optionalDependencies?: Record<string, string> },
  target: { platform: string; arch: string },
): string {
  const native = `${target.platform}-${target.arch}`
  return Object.hasOwn(manifest.optionalDependencies ?? {}, `@deepseek-ai/libreoffice-kit-${native}`)
    ? native : 'wasm'
}
