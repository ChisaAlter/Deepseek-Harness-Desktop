/**
 * Shared no-shell `execFile` runner for host-native OS integrations.
 * @module @deepseek-ai/dsh-native-command/runner
 */

import { execFile } from 'node:child_process'

/** Testable command boundary; native implementations never invoke a shell. */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and selected Windows visibility.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort terminates the child.
 * @param windowsHide - whether Windows should hide the launched program's window.
 * @returns captured stdout/stderr on exit 0.
 */
function runCommand(command: string, args: readonly string[], signal: AbortSignal, windowsHide: boolean): ReturnType<NativeCommandRunner> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide },
      (error, stdout, stderr) => {
        if (error !== null) {
          const failure = Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stdout,
            stderr,
          })
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

/** Hide native background commands on Windows. */
export const runNativeCommand: NativeCommandRunner = (command, args, signal) =>
  runCommand(command, args, signal, true)

/** Launch a desktop GUI command without hiding its window on Windows. */
export const runNativeVisibleCommand: NativeCommandRunner = (command, args, signal) =>
  runCommand(command, args, signal, false)
