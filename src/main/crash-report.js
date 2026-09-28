'use strict';

/**
 * Crash report files: the complete diagnostic of one fatal Desktop failure,
 * written before the recovery dialog so the dialog can name the file.
 * Ported from upstream apps/desktop/crash-report.ts + startup-error.ts.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { inspect } = require('node:util');

/** Where a fatal failure surfaced. */
const SOURCES = new Set(['host', 'web-boot', 'renderer', 'main']);

const CRASH_REPORT_PREFIX = 'crash-';
const CRASH_REPORT_NAME = /^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:host|web-boot|renderer|main)\.log$/u;
const CRASH_REPORTS_RETAINED = 10;
const RENDERER_CONSOLE_MAX_BYTES = 64 * 1024;
const ERROR_SECTION_MAX_CHARS = 256 * 1024;

/** Preserve nested diagnostics when sending failures to a renderer. */
function desktopErrorState(error) {
  const message = error instanceof AggregateError
    ? [error.message, ...error.errors.map((item) => desktopErrorState(item).message)].join('\n')
    : error instanceof Error ? error.message : String(error);
  return { phase: 'error', message };
}

/** Bounded tail of renderer error-level console lines, oldest first. */
class RendererConsoleTail {
  constructor(maxBytes = RENDERER_CONSOLE_MAX_BYTES) {
    this.maxBytes = maxBytes;
    this.lines = [];
    this.bytes = 0;
  }

  push(line) {
    this.lines.push(line);
    this.bytes += Buffer.byteLength(line);
    while (this.lines.length > 1 && this.bytes > this.maxBytes) {
      this.bytes -= Buffer.byteLength(this.lines.shift());
    }
  }

  snapshot() {
    return [...this.lines];
  }
}

function crashReportFileName(time, source) {
  return `${CRASH_REPORT_PREFIX}${time.toISOString().replaceAll(/[:.]/gu, '-')}-${source}.log`;
}

function boundedErrorSection(error) {
  const rendered = inspect(error, { depth: 6, maxStringLength: 64 * 1024, maxArrayLength: 100, breakLength: 120 });
  return rendered.length <= ERROR_SECTION_MAX_CHARS
    ? rendered
    : `${rendered.slice(0, ERROR_SECTION_MAX_CHARS)}\n… (error section cut at ${ERROR_SECTION_MAX_CHARS} characters)`;
}

function renderCrashReport(input) {
  const header = [
    `time: ${input.time.toISOString()}`,
    `source: ${input.source}`,
    `phase: ${input.phase}`,
    `app: ${input.app.name} ${input.app.version}`,
    `platform: ${input.app.platform} ${input.app.arch}`,
    `electron: ${input.app.electron}`,
    `node: ${input.app.node}`,
    `locale: ${input.app.locale}`,
    `shell pid: ${String(process.pid)}`,
  ];
  const consoleSection = input.rendererConsole.length === 0
    ? '(no error-level renderer console output was captured)'
    : input.rendererConsole.join('\n');
  return [
    header.join('\n'),
    '',
    '--- error ---',
    boundedErrorSection(input.error),
    '',
    ...(input.hostDiagnostic === undefined ? [] : ['--- host diagnostic (as reported by the Host process) ---', input.hostDiagnostic, '']),
    '--- renderer console (error level, oldest first) ---',
    consoleSection,
    '',
  ].join('\n');
}

/**
 * Write one report; failure resolves `undefined` so the recovery dialog
 * proceeds without a file rather than failing over a diagnostic aid.
 */
async function writeCrashReport(directory, input) {
  const file = path.join(directory, crashReportFileName(input.time, input.source));
  try {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsp.writeFile(file, renderCrashReport(input), { mode: 0o600, flag: 'wx' });
    return file;
  } catch (error) {
    console.error('dshd: crash report could not be written', file, error);
    return undefined;
  }
}

/** Delete the oldest reports beyond `retained`, judged by file-name order. */
async function pruneCrashReports(directory, retained = CRASH_REPORTS_RETAINED) {
  let names;
  try {
    names = await fsp.readdir(directory);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    console.error('dshd: crash report directory could not be listed', directory, error);
    return;
  }
  const reports = names.filter((name) => CRASH_REPORT_NAME.test(name)).sort();
  const excess = reports.slice(0, Math.max(0, reports.length - retained));
  for (const name of excess) {
    try {
      await fsp.unlink(path.join(directory, name));
    } catch (error) {
      console.error('dshd: stale crash report could not be removed', path.join(directory, name), error);
    }
  }
}

/**
 * Collect error-level console lines from one renderer into a tail buffer.
 * console-message levels: 0=verbose 1=info 2=warning 3=error.
 * @param {any} contents - renderer WebContents (Electron >=41: console-message takes an Event object).
 * @param {RendererConsoleTail} tail
 */
function attachRendererConsoleTail(contents, tail) {
  if (!contents || contents.__dshdConsoleTailAttached) return;
  contents.__dshdConsoleTailAttached = true;
  contents.on('console-message', (details) => {
    const level = details && (details.level ?? details.details?.level);
    const message = details && (details.message ?? details.details?.message);
    if (level === 3 && typeof message === 'string') tail.push(message);
  });
}

module.exports = {
  CRASH_REPORTS_RETAINED,
  ERROR_SECTION_MAX_CHARS,
  RENDERER_CONSOLE_MAX_BYTES,
  SOURCES,
  RendererConsoleTail,
  attachRendererConsoleTail,
  crashReportFileName,
  desktopErrorState,
  pruneCrashReports,
  renderCrashReport,
  writeCrashReport,
};
