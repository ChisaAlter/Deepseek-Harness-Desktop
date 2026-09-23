/**
 * Types for the per-stage build credentials.
 *
 * The implementation is a `.mjs` module on purpose: the root `prestart` gate
 * consumes it without a TypeScript toolchain, while `scripts/build.ts` imports
 * the same file. These declarations keep the build script typed without adding
 * a second copy of the logic.
 */

/** Schema version of a persisted stage credential. */
export const STAGE_CREDENTIAL_FORMAT: number

/** Repository-relative path of the persisted stage credentials. */
export const STAGE_CREDENTIAL_PATH: string

/** A build stage in dependency order. */
export type BuildStage = 'native-system' | 'host' | 'client' | 'web'

/** Stage names in dependency order. */
export const BUILD_STAGES: readonly BuildStage[]

/** One stage's recorded identity. */
export interface StageCredential {
  readonly inputs: string
  readonly inputManifest: string
  readonly outputs: string
  readonly outputManifest: string
  readonly environment: string
  readonly inputCount: number
  readonly outputCount: number
}

/** Persisted credential file. */
export interface StageCredentialFile {
  readonly formatVersion: number
  readonly environment: Readonly<Record<string, string>>
  readonly stages: Readonly<Partial<Record<BuildStage, StageCredential>>>
}

/** Per-run cache of the working tree's paths, timestamps and contents. */
export interface TreeIndex {
  select(roots: readonly string[], generated: boolean): Promise<string[]>
  manifestOf(path: string): Promise<string>
  contentOf(path: string): Promise<string>
}

/** Verification options. */
export interface VerifyOptions {
  /** Read every file even when the recorded manifest matches. */
  readonly content?: boolean
}

/** Create the per-run tree index. */
export function createTreeIndex(root: string): TreeIndex

/** Capture one stage's credential from the post-build working tree. */
export function captureStageCredential(
  root: string,
  stage: BuildStage,
  environment: Readonly<Record<string, string>>,
  index?: TreeIndex,
): Promise<StageCredential>

/** Verify a persisted credential against the current working tree. */
export function verifyStageCredential(
  root: string,
  stage: BuildStage,
  persisted: StageCredentialFile | undefined,
  environment: Readonly<Record<string, string>>,
  options?: VerifyOptions,
  index?: TreeIndex,
): Promise<boolean>

/** Which stages a complete build must run. */
export function stagesToRun(
  root: string,
  environment: Readonly<Record<string, string>>,
  persisted: StageCredentialFile | undefined,
  options?: VerifyOptions,
  index?: TreeIndex,
): Promise<BuildStage[]>

/** Read and validate the persisted credential file. */
export function readStageCredentials(root: string): StageCredentialFile | undefined

/** Build the credential file for the stages that just ran. */
export function buildStageCredentials(
  root: string,
  environment: Readonly<Record<string, string>>,
  ran: readonly BuildStage[],
  persisted: StageCredentialFile | undefined,
  index?: TreeIndex,
): Promise<StageCredentialFile>

/** Persist a credential file. */
export function writeStageCredentials(
  root: string,
  credentials: StageCredentialFile,
): Promise<void>
