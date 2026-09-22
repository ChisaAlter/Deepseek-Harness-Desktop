/** Public-key verification result; no hardware authentication is performed. */
export interface WindowsRuntimeSignature {
  status: string
  timestamped: boolean
  thumbprint: string | null
}

/**
 * Read Windows trust, timestamp and signer identity using the engine's bundled modules, without accessing the private key.
 * @param path File to inspect.
 * @returns Authenticode verification result.
 */
export function inspectWindowsRuntimeSignature(path: string): Promise<WindowsRuntimeSignature>

/**
 * Preserve a copied primary-runtime executable only after signature and exact-byte verification.
 * @param path Signing-hook target.
 * @param options Prepared and copied runtime roots with retained audit directory.
 * @returns True for a verified runtime copy; false for targets outside that directory.
 */
export function preserveWindowsRuntimeSignature(path: string, options: {
  sourceRoot: string
  destinationRoot: string
  runDirectory: string
  inspect?: typeof inspectWindowsRuntimeSignature
}): Promise<boolean>
