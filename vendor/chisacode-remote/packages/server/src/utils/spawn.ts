import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, extname } from "node:path";

import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/chisacode-env.js";
import {
  TREE_KILL_CLEANUP_TIMEOUT_MS,
  terminateWithTreeKill,
  type TerminateWithTreeKillResult,
  type TreeKillOwnership,
} from "./tree-kill.js";
import {
  isWindowsCommandScript,
  quoteWindowsArgument,
  quoteWindowsCommand,
} from "./windows-command.js";

const COMMAND_GRACEFUL_TERMINATION_MS = 250;
const COMMAND_FORCE_TERMINATION_MS = 2_000;
const DEFAULT_EXEC_MAX_BUFFER = 1024 * 1024;

interface ExternalEnvOptions {
  baseEnv?: ProcessEnvRecord;
  envMode?: "external" | "internal";
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
}

export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;

interface ExecCommandOptions extends ExternalEnvOptions {
  cleanupTimeoutMs?: number;
  cwd?: string;
  encoding?: BufferEncoding;
  killSignal?: NodeJS.Signals;
  signal?: AbortSignal;
  timeout?: number;
  maxBuffer?: number;
  runtime?: ExecCommandRuntime;
  shell?: boolean | string;
}

interface ExecCommandResult {
  stdout: string;
  stderr: string;
}

interface ExecCommandError extends Error {
  code?: number | string | null;
  cmd?: string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

type ExecCommandTerminationReason = "abort" | "maxBuffer" | "timeout";

interface ExecCommandRuntime {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
  terminate(
    child: ChildProcess,
    options: Parameters<typeof terminateWithTreeKill>[1],
  ): Promise<TerminateWithTreeKillResult>;
}

const DEFAULT_EXEC_COMMAND_RUNTIME: ExecCommandRuntime = {
  spawn(command, args, options) {
    return spawn(command, args, options);
  },
  terminate(child, options) {
    return terminateWithTreeKill(child, options);
  },
};

interface ExecCommandTimeoutErrorOptions extends ErrorOptions {
  cleanupCause?: unknown;
  cmd?: string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  terminationResult?: TerminateWithTreeKillResult;
}

interface ExecCommandKillTimeoutErrorOptions extends ErrorOptions {
  cleanupCause?: unknown;
  cmd: string;
  signal: NodeJS.Signals;
  stderr: string;
  stdout: string;
  terminationReason: ExecCommandTerminationReason;
}

const MAX_UTF8_COMPLETION_BYTES = 3;
const MAX_UTF16LE_COMPLETION_BYTES = 3;

function getCharacterCompletionSlack(encoding: BufferEncoding): number {
  const normalizedEncoding = encoding.toLowerCase();
  if (normalizedEncoding === "utf8" || normalizedEncoding === "utf-8") {
    return MAX_UTF8_COMPLETION_BYTES;
  }
  if (
    normalizedEncoding === "utf16le" ||
    normalizedEncoding === "utf-16le" ||
    normalizedEncoding === "ucs2" ||
    normalizedEncoding === "ucs-2"
  ) {
    return MAX_UTF16LE_COMPLETION_BYTES;
  }
  return 0;
}

function isEncodedOutputTransform(encoding: BufferEncoding): boolean {
  const normalizedEncoding = encoding.toLowerCase();
  return (
    normalizedEncoding === "hex" ||
    normalizedEncoding === "base64" ||
    normalizedEncoding === "base64url"
  );
}

function isUtf8ContinuationByte(value: number): boolean {
  return value >= 0x80 && value <= 0xbf;
}

function getUtf8SequenceLength(leadingByte: number): number {
  if (leadingByte <= 0x7f) {
    return 1;
  }
  if (leadingByte >= 0xc2 && leadingByte <= 0xdf) {
    return 2;
  }
  if (leadingByte >= 0xe0 && leadingByte <= 0xef) {
    return 3;
  }
  if (leadingByte >= 0xf0 && leadingByte <= 0xf4) {
    return 4;
  }
  return 0;
}

function getUtf8CompletionTarget(buffer: Buffer, boundary: number): number {
  if (boundary === 0) {
    return 0;
  }
  let sequenceStart = boundary - 1;
  while (sequenceStart >= 0 && isUtf8ContinuationByte(buffer[sequenceStart] ?? 0)) {
    sequenceStart -= 1;
  }
  if (sequenceStart < 0) {
    return boundary;
  }
  const sequenceLength = getUtf8SequenceLength(buffer[sequenceStart] ?? 0);
  return sequenceLength > boundary - sequenceStart ? sequenceStart + sequenceLength : boundary;
}

function getCompleteUtf8ByteLength(buffer: Buffer, boundary: number): number {
  if (boundary === 0) {
    return 0;
  }

  let sequenceStart = boundary - 1;
  while (sequenceStart >= 0 && isUtf8ContinuationByte(buffer[sequenceStart] ?? 0)) {
    sequenceStart -= 1;
  }
  if (sequenceStart < 0) {
    return 0;
  }

  const sequenceLength = getUtf8SequenceLength(buffer[sequenceStart] ?? 0);
  if (sequenceLength === 0 || boundary - sequenceStart >= sequenceLength) {
    return boundary;
  }

  const completedBoundary = sequenceStart + sequenceLength;
  if (completedBoundary > buffer.byteLength) {
    return sequenceStart;
  }
  for (let index = sequenceStart + 1; index < completedBoundary; index += 1) {
    if (!isUtf8ContinuationByte(buffer[index] ?? 0)) {
      return sequenceStart;
    }
  }
  return completedBoundary;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function getUtf16LeCompletionTarget(buffer: Buffer, boundary: number): number {
  const codeUnitBoundary = boundary - (boundary % 2);
  if (boundary % 2 === 1) {
    if (codeUnitBoundary + 2 > buffer.byteLength) {
      return codeUnitBoundary + 2;
    }
    return isHighSurrogate(buffer.readUInt16LE(codeUnitBoundary))
      ? codeUnitBoundary + 4
      : codeUnitBoundary + 2;
  }
  if (boundary >= 2 && isHighSurrogate(buffer.readUInt16LE(boundary - 2))) {
    return boundary + 2;
  }
  return boundary;
}

function getCompleteUtf16LeByteLength(buffer: Buffer, boundary: number): number {
  const codeUnitBoundary = boundary - (boundary % 2);
  if (boundary % 2 === 1) {
    if (codeUnitBoundary + 2 > buffer.byteLength) {
      return codeUnitBoundary;
    }
    const codeUnit = buffer.readUInt16LE(codeUnitBoundary);
    if (isHighSurrogate(codeUnit)) {
      if (codeUnitBoundary + 4 > buffer.byteLength) {
        return codeUnitBoundary;
      }
      const nextCodeUnit = buffer.readUInt16LE(codeUnitBoundary + 2);
      return isLowSurrogate(nextCodeUnit) ? codeUnitBoundary + 4 : codeUnitBoundary;
    }
    if (isLowSurrogate(codeUnit)) {
      if (codeUnitBoundary < 2 || !isHighSurrogate(buffer.readUInt16LE(codeUnitBoundary - 2))) {
        return codeUnitBoundary;
      }
    }
    return codeUnitBoundary + 2;
  }

  if (boundary < 2) {
    return boundary;
  }
  const finalCodeUnit = buffer.readUInt16LE(boundary - 2);
  if (isHighSurrogate(finalCodeUnit)) {
    if (boundary + 2 > buffer.byteLength) {
      return boundary - 2;
    }
    const nextCodeUnit = buffer.readUInt16LE(boundary);
    return isLowSurrogate(nextCodeUnit) ? boundary + 2 : boundary - 2;
  }
  if (
    isLowSurrogate(finalCodeUnit) &&
    (boundary < 4 || !isHighSurrogate(buffer.readUInt16LE(boundary - 4)))
  ) {
    return boundary - 2;
  }
  return boundary;
}

function getCompleteOutputByteLength(
  buffer: Buffer,
  boundary: number,
  encoding: BufferEncoding,
): number {
  const normalizedEncoding = encoding.toLowerCase();
  if (normalizedEncoding === "utf8" || normalizedEncoding === "utf-8") {
    return getCompleteUtf8ByteLength(buffer, boundary);
  }
  if (
    normalizedEncoding === "utf16le" ||
    normalizedEncoding === "utf-16le" ||
    normalizedEncoding === "ucs2" ||
    normalizedEncoding === "ucs-2"
  ) {
    return getCompleteUtf16LeByteLength(buffer, boundary);
  }
  return boundary;
}

function getOutputCompletionTarget(
  buffer: Buffer,
  boundary: number,
  encoding: BufferEncoding,
): number {
  const normalizedEncoding = encoding.toLowerCase();
  if (normalizedEncoding === "utf8" || normalizedEncoding === "utf-8") {
    return getUtf8CompletionTarget(buffer, boundary);
  }
  if (
    normalizedEncoding === "utf16le" ||
    normalizedEncoding === "utf-16le" ||
    normalizedEncoding === "ucs2" ||
    normalizedEncoding === "ucs-2"
  ) {
    return getUtf16LeCompletionTarget(buffer, boundary);
  }
  return boundary;
}

class BoundedOutputBuffer {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;
  private readonly byteLimit: number;
  private readonly captureLimit: number;
  private observedByteLength = 0;
  private overflowed = false;

  constructor(
    private readonly maxBytes: number,
    private readonly encoding: BufferEncoding,
  ) {
    this.byteLimit = Number.isFinite(maxBytes) ? Math.floor(maxBytes) : maxBytes;
    this.captureLimit = Number.isFinite(this.byteLimit)
      ? this.byteLimit + getCharacterCompletionSlack(encoding)
      : this.byteLimit;
  }

  append(value: Buffer | string): boolean {
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    this.observedByteLength += chunk.byteLength;
    let offset = 0;
    if (!this.overflowed) {
      const remainingBudget = Math.max(0, this.byteLimit - this.byteLength);
      const budgetBytes = Math.min(chunk.byteLength, remainingBudget);
      this.appendCopiedSlice(chunk, 0, budgetBytes);
      offset = budgetBytes;
      this.overflowed = this.observedByteLength > this.maxBytes;
    }
    if (this.overflowed && offset < chunk.byteLength) {
      this.appendCompletionBytes(chunk, offset);
    }
    return this.overflowed;
  }

  needsCompletion(): boolean {
    if (!this.overflowed) {
      return false;
    }
    const buffer = Buffer.concat(this.chunks, this.byteLength);
    const boundary = Math.min(this.byteLimit, buffer.byteLength);
    const target = Math.min(
      getOutputCompletionTarget(buffer, boundary, this.encoding),
      this.captureLimit,
    );
    return this.byteLength < target;
  }

  toString(): string {
    const buffer = Buffer.concat(this.chunks, this.byteLength);
    const outputByteLength = this.overflowed
      ? getCompleteOutputByteLength(
          buffer,
          Math.min(this.byteLimit, buffer.byteLength),
          this.encoding,
        )
      : buffer.byteLength;
    const output = buffer.subarray(0, outputByteLength).toString(this.encoding);
    return this.overflowed && isEncodedOutputTransform(this.encoding)
      ? output.slice(0, this.byteLimit)
      : output;
  }

  private appendCompletionBytes(chunk: Buffer, start: number): void {
    let offset = start;
    while (offset < chunk.byteLength && this.needsCompletion()) {
      const buffer = Buffer.concat(this.chunks, this.byteLength);
      const boundary = Math.min(this.byteLimit, buffer.byteLength);
      const target = Math.min(
        getOutputCompletionTarget(buffer, boundary, this.encoding),
        this.captureLimit,
      );
      const bytesToCopy = Math.min(chunk.byteLength - offset, target - this.byteLength);
      if (bytesToCopy <= 0) {
        return;
      }
      this.appendCopiedSlice(chunk, offset, offset + bytesToCopy);
      offset += bytesToCopy;
    }
  }

  private appendCopiedSlice(chunk: Buffer, start: number, end: number): void {
    if (end <= start) {
      return;
    }
    const copy = Buffer.from(chunk.subarray(start, end));
    this.chunks.push(copy);
    this.byteLength += copy.byteLength;
  }
}

/** Identifies a command that exceeded the configured execution timeout. */
export class ExecCommandTimeoutError extends Error {
  readonly code = "EXEC_COMMAND_TIMEOUT";
  readonly cmd: string;
  readonly cleanupCause: unknown;
  readonly killed: boolean;
  readonly signal: NodeJS.Signals;
  readonly terminationResult: TerminateWithTreeKillResult | undefined;

  /**
   * Creates a timeout error with captured command output.
   * @param timeoutMs Configured timeout in milliseconds
   * @param stdout Captured standard output
   * @param stderr Captured standard error
   * @param options Optional error cause and child-process compatibility metadata
   */
  constructor(
    readonly timeoutMs: number,
    readonly stdout: string,
    readonly stderr: string,
    options?: ExecCommandTimeoutErrorOptions,
  ) {
    super(`Command timed out after ${timeoutMs}ms`, options);
    this.name = "ExecCommandTimeoutError";
    this.cleanupCause = options?.cleanupCause;
    this.cmd = options?.cmd ?? "";
    this.killed = options?.killed ?? true;
    this.signal = options?.signal ?? "SIGTERM";
    this.terminationResult = options?.terminationResult;
  }
}

/** Identifies a command tree that could not be confirmed stopped within the cleanup deadline. */
export class ExecCommandKillTimeoutError extends Error {
  readonly code = "EXEC_COMMAND_KILL_TIMEOUT";
  readonly cleanupCause: unknown;
  readonly killed = false;
  readonly cmd: string;
  readonly signal: NodeJS.Signals;
  readonly stderr: string;
  readonly stdout: string;
  readonly terminationReason: ExecCommandTerminationReason;

  /**
   * Creates a bounded cleanup failure with the original termination error as its cause.
   * @param options Cleanup failure metadata
   */
  constructor(options: ExecCommandKillTimeoutErrorOptions) {
    super(`Command tree did not terminate after ${options.terminationReason}`, {
      cause: options.cause,
    });
    this.name = "ExecCommandKillTimeoutError";
    this.cleanupCause = options.cleanupCause;
    this.cmd = options.cmd;
    this.signal = options.signal;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
    this.terminationReason = options.terminationReason;
  }
}

class ExecCommandCleanupTimeoutError extends Error {
  readonly code = "EXEC_COMMAND_KILL_TIMEOUT";

  constructor() {
    super("Command tree cleanup could not be confirmed before the deadline");
    this.name = "ExecCommandCleanupTimeoutError";
  }
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function shouldUseWindowsShell(
  command: string,
  requestedShell?: boolean | string,
): boolean | string {
  if (isWindowsCommandScript(command)) {
    return true;
  }
  if (requestedShell !== undefined) {
    return requestedShell;
  }
  return process.platform === "win32" && !hasPathSeparator(command) && !extname(command);
}

function parseWindowsCommandTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function resolveWindowsCommandShim(
  command: string,
  args: string[],
): { command: string; args: string[] } | null {
  if (!isWindowsCommandScript(command) || !existsSync(command)) {
    return null;
  }

  let contents: string;
  try {
    contents = readFileSync(command, "utf8");
  } catch {
    return null;
  }

  const scriptDir = `${dirname(command)}\\`;
  const lines = contents.split(/\r?\n/u);
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const rawLine = lines[lineIndex] ?? "";
    const line = rawLine.trim();
    const splatIndex = line.toLowerCase().lastIndexOf("%*");
    if (splatIndex === -1) {
      continue;
    }

    const prefix = line
      .slice(0, splatIndex)
      .replace(/%~?dp0%/giu, scriptDir)
      .trim();
    let tokens = parseWindowsCommandTokens(prefix);
    if (tokens[0]?.toLowerCase() === "call") {
      tokens = tokens.slice(1);
    }
    const [resolvedCommand, ...fixedArgs] = tokens;
    if (resolvedCommand && existsSync(resolvedCommand)) {
      return {
        command: resolvedCommand,
        args: [...fixedArgs, ...args],
      };
    }
  }

  return null;
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const shimLaunch = process.platform === "win32" ? resolveWindowsCommandShim(command, args) : null;
  const launchCommand = shimLaunch?.command ?? command;
  const launchArgs = shimLaunch?.args ?? args;
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const isWindows = process.platform === "win32";
  const shell = shimLaunch ? false : shouldUseWindowsShell(launchCommand, spawnOptions.shell);

  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(launchCommand) : launchCommand;
  const resolvedArgs = shouldQuoteForShell ? launchArgs.map(quoteWindowsArgument) : launchArgs;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          launchCommand,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  return spawn(resolvedCommand, resolvedArgs, {
    ...spawnOptions,
    env: childEnv,
    shell,
    windowsHide: true,
  });
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  validateExecCommandOptions(options);
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const isWindows = process.platform === "win32";
  const shell = shouldUseWindowsShell(command, options?.shell);
  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(command) : command;
  const resolvedArgs = shouldQuoteForShell ? args.map(quoteWindowsArgument) : args;
  const commandText = [resolvedCommand, ...resolvedArgs].join(" ");
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  if (options?.signal?.aborted) {
    throw createExecCommandAbortError(options.signal.reason, commandText, "", "");
  }

  return new Promise<ExecCommandResult>((resolve, reject) => {
    const runtime = options?.runtime ?? DEFAULT_EXEC_COMMAND_RUNTIME;
    const encoding = options?.encoding ?? "utf8";
    const maxBuffer = options?.maxBuffer ?? DEFAULT_EXEC_MAX_BUFFER;
    const stdoutBuffer = new BoundedOutputBuffer(maxBuffer, encoding);
    const stderrBuffer = new BoundedOutputBuffer(maxBuffer, encoding);
    let terminationReason: ExecCommandTerminationReason | null = null;
    let terminationResult: TerminateWithTreeKillResult | null = null;
    let terminationFailure: unknown;
    let cleanupTimeoutHandle: NodeJS.Timeout | null = null;
    let cleanupController: AbortController | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let spawnError: Error | null = null;
    let maxBufferStream: "stderr" | "stdout" | null = null;
    let childClosed = false;
    let resolveChildClose: (() => void) | null = null;
    let exitCode: number | null = null;
    let signalCode: NodeJS.Signals | null = null;
    let settled = false;
    const launchedAtMs = Date.now();
    const usesProcessGroup = process.platform !== "win32";
    const child = runtime.spawn(resolvedCommand, resolvedArgs, {
      cwd: options?.cwd,
      // POSIX detached mode creates a new session/process group. The child stays referenced.
      detached: usesProcessGroup,
      env: childEnv,
      shell,
      windowsHide: true,
    });
    const childClosePromise = new Promise<void>((resolveClose) => {
      resolveChildClose = resolveClose;
    });
    const terminationOwnership = createExecCommandOwnership(child, launchedAtMs, usesProcessGroup);
    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (cleanupTimeoutHandle) {
        clearTimeout(cleanupTimeoutHandle);
        cleanupTimeoutHandle = null;
      }
      options?.signal?.removeEventListener("abort", onAbort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
      resolveChildClose?.();
      resolveChildClose = null;
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };
    const finishIfReady = () => {
      if (settled) {
        return;
      }
      if (terminationReason) {
        if (terminationResult === null) {
          return;
        }
        if (terminationResult !== "kill-timeout" && !childClosed) {
          return;
        }
      } else if (!childClosed) {
        return;
      }
      settled = true;
      cleanup();
      settleExecCommand({
        abortReason: options?.signal?.reason,
        commandText,
        exitCode,
        killSignal: options?.killSignal,
        maxBufferStream,
        reject,
        resolve,
        signalCode,
        spawnError,
        stderr: stderrBuffer.toString(),
        stdout: stdoutBuffer.toString(),
        terminationFailure,
        terminationReason,
        terminationResult,
        timeoutMs: options?.timeout,
      });
    };
    const requestTermination = (reason: ExecCommandTerminationReason) => {
      if (settled || terminationReason) {
        return;
      }
      terminationReason = reason;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      const cleanupTimeoutMs = options?.cleanupTimeoutMs ?? TREE_KILL_CLEANUP_TIMEOUT_MS;
      cleanupController = new AbortController();
      cleanupTimeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        const cleanupFailure = new ExecCommandCleanupTimeoutError();
        cleanupController?.abort(cleanupFailure);
        terminationFailure = cleanupFailure;
        terminationResult = "kill-timeout";
        finishIfReady();
      }, cleanupTimeoutMs);
      void runtime
        .terminate(child, {
          cleanupTimeoutMs,
          closure: childClosePromise,
          gracefulSignal: options?.killSignal,
          gracefulTimeoutMs: COMMAND_GRACEFUL_TERMINATION_MS,
          forceTimeoutMs: COMMAND_FORCE_TERMINATION_MS,
          ownership: terminationOwnership,
          signal: cleanupController.signal,
        })
        .then(
          (result) => {
            if (settled) {
              return;
            }
            if (result === "kill-timeout") {
              terminationFailure = new ExecCommandCleanupTimeoutError();
            }
            terminationResult = result;
            return finishIfReady();
          },
          (error: unknown) => {
            if (settled) {
              return;
            }
            terminationFailure = error;
            terminationResult = "kill-timeout";
            return finishIfReady();
          },
        );
    };
    const appendOutput = (
      target: BoundedOutputBuffer,
      stream: "stderr" | "stdout",
      chunk: Buffer | string,
    ) => {
      if (terminationReason) {
        if (
          terminationReason === "maxBuffer" &&
          maxBufferStream === stream &&
          target.needsCompletion()
        ) {
          target.append(chunk);
        }
        return;
      }
      if (target.append(chunk)) {
        maxBufferStream = stream;
        requestTermination("maxBuffer");
      }
    };
    const onAbort = () => requestTermination("abort");
    const onStdout = (chunk: Buffer | string) => {
      appendOutput(stdoutBuffer, "stdout", chunk);
    };
    const onStderr = (chunk: Buffer | string) => {
      appendOutput(stderrBuffer, "stderr", chunk);
    };
    const onError = (error: Error) => {
      spawnError = error;
    };
    const onClose = (closedExitCode: number | null, closedSignalCode: NodeJS.Signals | null) => {
      childClosed = true;
      resolveChildClose?.();
      resolveChildClose = null;
      exitCode = closedExitCode;
      signalCode = closedSignalCode;
      finishIfReady();
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    if (options?.signal?.aborted) {
      onAbort();
    }
    if (!terminationReason && options?.timeout !== undefined && options.timeout > 0) {
      timeoutHandle = setTimeout(() => requestTermination("timeout"), options.timeout);
    }
  });
}

function createExecCommandOwnership(
  child: ChildProcess,
  launchedAtMs: number,
  usesProcessGroup: boolean,
): TreeKillOwnership | undefined {
  if (typeof child.pid !== "number") {
    return undefined;
  }
  return {
    launchedAtMs,
    processGroupId: usesProcessGroup ? child.pid : undefined,
    rootPid: child.pid,
  };
}

function settleExecCommand(options: {
  abortReason: unknown;
  commandText: string;
  exitCode: number | null;
  killSignal: NodeJS.Signals | undefined;
  maxBufferStream: "stderr" | "stdout" | null;
  reject: (reason?: unknown) => void;
  resolve: (result: ExecCommandResult) => void;
  signalCode: NodeJS.Signals | null;
  spawnError: Error | null;
  stderr: string;
  stdout: string;
  terminationFailure: unknown;
  terminationReason: ExecCommandTerminationReason | null;
  terminationResult: TerminateWithTreeKillResult | null;
  timeoutMs: number | undefined;
}): void {
  const terminationReason = options.terminationReason;
  if (terminationReason) {
    const terminationError = createExecCommandTerminationError({
      ...options,
      terminationReason,
    });
    if (options.terminationResult === "kill-timeout") {
      if (terminationReason === "timeout") {
        options.reject(
          new ExecCommandTimeoutError(options.timeoutMs ?? 0, options.stdout, options.stderr, {
            cause: terminationError,
            cleanupCause: options.terminationFailure,
            cmd: options.commandText,
            killed: false,
            signal: options.killSignal ?? "SIGTERM",
            terminationResult: "kill-timeout",
          }),
        );
        return;
      }
      options.reject(
        new ExecCommandKillTimeoutError({
          cause: terminationError,
          cleanupCause: options.terminationFailure,
          cmd: options.commandText,
          signal: options.killSignal ?? "SIGTERM",
          stderr: options.stderr,
          stdout: options.stdout,
          terminationReason,
        }),
      );
      return;
    }
    options.reject(terminationError);
    return;
  }
  if (options.spawnError) {
    const commandError = options.spawnError as ExecCommandError;
    commandError.cmd = options.commandText;
    commandError.stdout = options.stdout;
    commandError.stderr = options.stderr;
    options.reject(commandError);
    return;
  }
  if (options.exitCode === 0) {
    options.resolve({ stdout: options.stdout, stderr: options.stderr });
    return;
  }
  options.reject(
    createExecCommandExitError({
      commandText: options.commandText,
      exitCode: options.exitCode,
      signalCode: options.signalCode,
      stderr: options.stderr,
      stdout: options.stdout,
    }),
  );
}

function createExecCommandTerminationError(options: {
  abortReason: unknown;
  commandText: string;
  killSignal: NodeJS.Signals | undefined;
  maxBufferStream: "stderr" | "stdout" | null;
  spawnError: Error | null;
  stderr: string;
  stdout: string;
  terminationReason: ExecCommandTerminationReason;
  timeoutMs: number | undefined;
}): ExecCommandError {
  if (options.terminationReason === "abort") {
    return createExecCommandAbortError(
      options.abortReason,
      options.commandText,
      options.stdout,
      options.stderr,
    );
  }
  if (options.terminationReason === "maxBuffer") {
    return createMaxBufferError(
      options.maxBufferStream ?? "stdout",
      options.commandText,
      options.stdout,
      options.stderr,
    );
  }
  return new ExecCommandTimeoutError(options.timeoutMs ?? 0, options.stdout, options.stderr, {
    cause: options.spawnError ?? undefined,
    cmd: options.commandText,
    signal: options.killSignal ?? "SIGTERM",
  });
}

function validateExecCommandOptions(options: ExecCommandOptions | undefined): void {
  const timeout = options?.timeout;
  if (
    timeout !== undefined &&
    (!Number.isFinite(timeout) || !Number.isInteger(timeout) || timeout < 0)
  ) {
    throw createExecCommandRangeError("timeout", "an unsigned integer", timeout);
  }
  const maxBuffer = options?.maxBuffer;
  if (maxBuffer !== undefined && (Number.isNaN(maxBuffer) || maxBuffer < 0)) {
    throw createExecCommandRangeError("options.maxBuffer", "a positive number", maxBuffer);
  }
  const encoding = options?.encoding;
  if (encoding !== undefined && !Buffer.isEncoding(encoding)) {
    const error = new TypeError(`Unknown encoding: ${encoding}`) as TypeError & { code: string };
    error.code = "ERR_UNKNOWN_ENCODING";
    throw error;
  }
  const killSignal = options?.killSignal;
  if (killSignal !== undefined && !Object.hasOwn(osConstants.signals, killSignal)) {
    const error = new TypeError(`Unknown signal: ${killSignal}`) as TypeError & { code: string };
    error.code = "ERR_UNKNOWN_SIGNAL";
    throw error;
  }
}

function createExecCommandRangeError(
  name: string,
  requirement: string,
  value: number,
): RangeError & { code: string } {
  const error = new RangeError(
    `The value of "${name}" is out of range. It must be ${requirement}. Received ${String(value)}`,
  ) as RangeError & { code: string };
  error.code = "ERR_OUT_OF_RANGE";
  return error;
}

function createMaxBufferError(
  stream: "stderr" | "stdout",
  commandText: string,
  stdout: string,
  stderr: string,
): ExecCommandError {
  const error = new RangeError(`${stream} maxBuffer length exceeded`) as ExecCommandError;
  error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  error.cmd = commandText;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function createExecCommandExitError(options: {
  commandText: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}): ExecCommandError {
  const error = new Error(
    `Command failed: ${options.commandText}\n${options.stderr}`,
  ) as ExecCommandError;
  error.code = options.exitCode;
  error.cmd = options.commandText;
  error.killed = false;
  error.signal = options.signalCode;
  error.stdout = options.stdout;
  error.stderr = options.stderr;
  return error;
}

function createExecCommandAbortError(
  reason: unknown,
  commandText: string,
  stdout: string,
  stderr: string,
): ExecCommandError {
  const error = new Error("The operation was aborted", { cause: reason }) as ExecCommandError;
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  error.cmd = commandText;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

export function platformShell(): { command: string; flag: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd.exe", flag: ["/c"] };
  }

  return { command: "/bin/sh", flag: ["-lc"] };
}

export function platformBash(): { command: string; flag: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd.exe", flag: ["/c"] };
  }

  return { command: "/bin/bash", flag: ["-lc"] };
}
