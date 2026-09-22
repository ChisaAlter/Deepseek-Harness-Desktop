// Shared spawn helper available for scripts/*.mjs gates/build steps.
// NOTE: existing scripts (prestart-ensure.mjs, prepare-dshd-remote.mjs) keep
// their own local `run` because each has a distinct `cwd` default and extra
// semantics — extracting one shared helper was evaluated and rejected as the
// convergence cost outweighed the benefit. Kept for future scripts.
import { spawnSync } from 'node:child_process'

/**
 * Run `command args` synchronously, inheriting stdio, exiting on non-zero.
 * `shell` defaults to true on win32 (`.cmd`/`.bat` shims need it); pass
 * `shell:false` when `command` is an absolute path that may contain spaces —
 * such paths break under `shell:true` on Windows.
 *
 * Note: `spawnSync` preserves the child's real exit code in `result.status`
 * (it is NOT masked to 1 by `shell:true`). On signal/spawn error `status` is
 * null, so we fall back to 1.
 */
export function run(command, args, cwd, { shell = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
