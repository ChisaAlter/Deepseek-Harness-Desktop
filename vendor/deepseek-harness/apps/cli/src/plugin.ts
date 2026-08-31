/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 *
 * Activation is fail-closed against the host-feature contract: a dependency
 * whose `dsh.compatibility` declaration is malformed, or whose required
 * features this dsh host does not support, never joins the layer stack (and
 * leaves it if it was active), `runPlugin` returns nonzero, and diagnostics
 * say exactly what to do. A package with no compatibility declaration is
 * untouched. A newly-added incompatible dependency is rolled back (removed
 * from the profile's dependencies — the exact undo of the `add` that just
 * ran); a pre-existing one stays installed but inactive, and the diagnostic
 * says so.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  missingHostFeatures,
  parseCompatibilityFeatures,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** One dependency that failed the host-feature gate. */
export interface CompatibilityFailure {
  /** The dependency's package name. */
  packageName: string
  /** `malformed`: the declaration cannot be parsed; `missing-features`: requirements the host lacks. */
  kind: 'malformed' | 'missing-features'
  /** Host-unsupported requirement ids when `kind` is `missing-features`. */
  missing?: string[]
  /** Parse-error text when `kind` is `malformed`. */
  detail?: string
}

/** The pure outcome of one bundle-layer reconciliation. */
export interface ReconcileReport {
  /** Dependencies rejected by the host-feature gate (never activated). */
  failures: CompatibilityFailure[]
  /** Newly-added bundle-less dependencies (orientation warning, not a failure). */
  plainAdditions: string[]
  /** Packages that left `dsh.profile.bundles` during this reconciliation. */
  deactivated: string[]
  /** The reconciled bundle layer list. */
  bundles: string[]
  /** Whether the persisted bundle list changed. */
  changed: boolean
}

/**
 * The host-feature gate for one dependency manifest: malformed declarations
 * and unsupported requirements both fail closed; a missing compatibility
 * section (or an unresolvable package, which cannot activate anyway) passes.
 * @param packageName - the dependency's package name.
 * @param manifest - the dependency's parsed manifest; `undefined` when unresolvable.
 * @returns the failure, or `undefined` when the package passes the gate.
 */
export function compatibilityFailureOf(
  packageName: string, manifest: ProfileManifest | undefined,
): CompatibilityFailure | undefined {
  if (manifest === undefined) return undefined
  const compatibility = manifest.dsh?.compatibility
  if (compatibility === undefined) return undefined
  let required: string[]
  try {
    // The section exists here, so an undefined parse is impossible; the `?? []`
    // is the type-level witness for the shape-checked value.
    required = parseCompatibilityFeatures(packageName, compatibility) ?? []
  } catch (error) {
    return {
      packageName,
      kind: 'malformed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  const missing = missingHostFeatures(required)
  if (missing.length === 0) return undefined
  return { packageName, kind: 'missing-features', missing }
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state (pure; all
 * reads flow through `readManifest`): a dependency that resolves to a
 * `dsh.bundle`-declaring package joins the layer stack (appended in
 * dependency order); a dependency-listed name that no longer does — removed,
 * or the installed version dropped the declaration — leaves it. In-box
 * bundles from the profile template are not dependencies and are never
 * touched. A dependency that fails the host-feature gate never joins the
 * stack and is removed if present. Newly-added bundle-less dependencies are
 * reported as `plainAdditions` (a plain library is fine; the warning is
 * orientation).
 * @param before - the profile manifest read before pnpm ran.
 * @param after - the profile manifest pnpm wrote.
 * @param readManifest - resolves one dependency's manifest (undefined = unresolvable).
 * @returns the reconciliation outcome.
 */
export function reconcileBundleLayers(
  before: ProfileManifest,
  after: ProfileManifest,
  readManifest: (packageName: string) => ProfileManifest | undefined,
): ReconcileReport {
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = [...(after.dsh?.profile?.bundles ?? [])]
  const failures: CompatibilityFailure[] = []
  const plainAdditions: string[] = []
  const deactivated: string[] = []
  const manifests = new Map<string, ProfileManifest | undefined>()
  const manifestOf = (packageName: string): ProfileManifest | undefined => {
    if (!manifests.has(packageName)) manifests.set(packageName, readManifest(packageName))
    return manifests.get(packageName)
  }
  const exportsPatch = (packageName: string): boolean => manifestOf(packageName)?.dsh?.bundle?.patch !== undefined
  let changed = false
  for (const packageName of dependencies) {
    const failure = compatibilityFailureOf(packageName, manifestOf(packageName))
    if (failure !== undefined) {
      // A failed dependency never activates; if it was active, deactivate it.
      failures.push(failure)
      if (plugins.includes(packageName)) {
        plugins.splice(plugins.indexOf(packageName), 1)
        deactivated.push(packageName)
        changed = true
      }
      continue
    }
    if (exportsPatch(packageName)) {
      if (!plugins.includes(packageName)) {
        plugins.push(packageName)
        changed = true
      }
    } else if (!beforeDeps.has(packageName)) {
      plainAdditions.push(packageName)
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      deactivated.push(packageName)
      changed = true
    }
  }
  return { failures, plainAdditions, deactivated, bundles: plugins, changed }
}

/** Resolve one dependency's manifest from the disk (installation anchor first, then the profile). */
function readDependencyManifest(packageName: string, profileDir: string): ProfileManifest | undefined {
  try {
    return readProfileManifest(NAME, resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir))
  } catch {
    return undefined // unresolvable — pnpm reported success yet the package is missing; treated as plain
  }
}

/**
 * Reconcile `dsh.profile.bundles` after a successful pnpm run, persisting the
 * new bundle list when it changed. Writes the per-newly-added-bundle-less-
 * dependency orientation warning to stderr; compatibility failures are
 * returned (not printed) so the caller can roll back before diagnosing.
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): ReconcileReport {
  const after = readProfileManifest(NAME, profileDir)
  const report = reconcileBundleLayers(before, after, packageName => readDependencyManifest(packageName, profileDir))
  if (report.changed) {
    after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: report.bundles } }
    writeProfileManifest(profileDir, after)
  }
  for (const packageName of report.plainAdditions) {
    process.stderr.write(
      `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
      + '(a later update that gains one activates it automatically)\n',
    )
  }
  return report
}

/** Print one compatibility failure with the actionable next step. */
function printCompatibilityFailure(failure: CompatibilityFailure): void {
  if (failure.kind === 'malformed') {
    process.stderr.write(
      `${NAME}: ${failure.packageName} has a malformed dsh.compatibility declaration: ${failure.detail ?? 'unparseable'}\n`,
    )
    process.stderr.write(
      `${NAME}:   fix dsh.compatibility.features in the plugin's package.json (a string array of feature ids), then re-run\n`,
    )
    return
  }
  process.stderr.write(
    `${NAME}: ${failure.packageName} requires host features this dsh does not support: ${failure.missing?.join(', ') ?? ''}\n`,
  )
  process.stderr.write(
    `${NAME}:   update dsh to a host that provides them, or remove the plugin\n`,
  )
  process.stderr.write(`${NAME}: ${failure.packageName} was not activated in dsh.profile.bundles\n`)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Roll back a newly-added incompatible dependency: `pnpm remove` undoes
 * exactly the `add` that just ran (the package was not a dependency before
 * this invocation), so it is the clean rollback. A rollback that fails leaves
 * the dependency installed but inactive — never delete a user dependency
 * beyond undoing the command's own addition.
 * @param packageName - the incompatible dependency to remove.
 * @param profileDir - the profile directory.
 * @returns true when pnpm removed the dependency.
 */
function rollbackIncompatible(packageName: string, profileDir: string): boolean {
  const rollback = spawnSync('pnpm', ['remove', packageName], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return rollback.error === undefined && (rollback.status ?? 1) === 0
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * A dependency that fails the host-feature gate turns a successful pnpm run
 * into a nonzero exit: it never activates, newly-added ones are rolled back,
 * and diagnostics name the package and the missing or malformed contract.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code, or 1 when the compatibility gate rejects a dependency.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode !== 0) {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
    return exitCode
  }
  const report = reconcilePlugins(before, dir)
  if (report.failures.length === 0) return 0
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  for (const failure of report.failures) {
    printCompatibilityFailure(failure)
    if (!beforeDeps.has(failure.packageName)) {
      // Newly added by this invocation: undo exactly that addition.
      if (rollbackIncompatible(failure.packageName, dir)) {
        process.stderr.write(
          `${NAME}: ${failure.packageName} was rolled back (removed from the profile's dependencies)\n`,
        )
      } else {
        process.stderr.write(
          `${NAME}: ${failure.packageName} remains installed as an inactive dependency — remove it with `
          + `'dsh plugin --profile ${profile} remove ${failure.packageName}' or upgrade dsh\n`,
        )
      }
    } else {
      process.stderr.write(
        `${NAME}: ${failure.packageName} remains installed as an inactive dependency — update or remove it, or upgrade dsh\n`,
      )
    }
  }
  return 1
}
