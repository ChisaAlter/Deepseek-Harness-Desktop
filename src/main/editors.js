const { spawn: nodeSpawn, execFile: nodeExecFile } = require('node:child_process');
const { loadWorkspaceAuthority } = require('./workspace-authority');

const EDITORS = [
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], launchStyle: 'goto' },
  { id: 'trae', label: 'Trae', commands: ['trae'], launchStyle: 'goto' },
  { id: 'kiro', label: 'Kiro', commands: ['kiro'], baseArgs: ['ide'], launchStyle: 'goto' },
  { id: 'vscode', label: 'VS Code', commands: ['code'], launchStyle: 'goto' },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    commands: ['code-insiders'],
    launchStyle: 'goto',
  },
  { id: 'vscodium', label: 'VSCodium', commands: ['codium'], launchStyle: 'goto' },
  { id: 'zed', label: 'Zed', commands: ['zed', 'zeditor'], launchStyle: 'direct-path' },
  { id: 'antigravity', label: 'Antigravity', commands: ['agy'], launchStyle: 'goto' },
  { id: 'idea', label: 'IntelliJ IDEA', commands: ['idea'], launchStyle: 'line-column' },
  { id: 'aqua', label: 'Aqua', commands: ['aqua'], launchStyle: 'line-column' },
  { id: 'clion', label: 'CLion', commands: ['clion'], launchStyle: 'line-column' },
  { id: 'datagrip', label: 'DataGrip', commands: ['datagrip'], launchStyle: 'line-column' },
  { id: 'dataspell', label: 'DataSpell', commands: ['dataspell'], launchStyle: 'line-column' },
  { id: 'goland', label: 'GoLand', commands: ['goland'], launchStyle: 'line-column' },
  { id: 'phpstorm', label: 'PhpStorm', commands: ['phpstorm'], launchStyle: 'line-column' },
  { id: 'pycharm', label: 'PyCharm', commands: ['pycharm'], launchStyle: 'line-column' },
  { id: 'rider', label: 'Rider', commands: ['rider'], launchStyle: 'line-column' },
  { id: 'rubymine', label: 'RubyMine', commands: ['rubymine'], launchStyle: 'line-column' },
  { id: 'rustrover', label: 'RustRover', commands: ['rustrover'], launchStyle: 'line-column' },
  { id: 'webstorm', label: 'WebStorm', commands: ['webstorm'], launchStyle: 'line-column' },
  { id: 'file-manager', label: 'File Manager', commands: null, launchStyle: 'direct-path' },
];

let workspaceAuthority = null;

/** Test seam: pin the trust root (node:test runs outside Electron). */
function setWorkspaceAuthority(authority) {
  workspaceAuthority = authority;
}

function authority() {
  if (workspaceAuthority === null) workspaceAuthority = loadWorkspaceAuthority();
  return workspaceAuthority;
}

function resolveInside(cwd, relativePath) {
  return authority().resolveInside(cwd, relativePath);
}

function fail(message) {
  return { ok: false, message };
}

function commandOnPath(command, deps = {}) {
  const execFile = deps.execFile ?? nodeExecFile;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  return new Promise((resolve) => {
    const file = platform === 'win32' ? 'where.exe' : '/bin/sh';
    const args = platform === 'win32' ? [command] : ['-c', `command -v ${JSON.stringify(command)}`];
    execFile(file, args, { env, windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

async function firstAvailableCommand(commands, deps) {
  for (const command of commands) {
    if (await commandOnPath(command, deps)) return command;
  }
  return null;
}

function resolveEditorArgs(editor, absolutePath, line, column) {
  const baseArgs = editor.baseArgs ? [...editor.baseArgs] : [];
  const hasLine = typeof line === 'number';
  switch (editor.launchStyle) {
    case 'direct-path':
      return [...baseArgs, absolutePath];
    case 'goto':
      if (hasLine) {
        const col = typeof column === 'number' ? column : 1;
        return [...baseArgs, '--goto', `${absolutePath}:${line}:${col}`];
      }
      return [...baseArgs, absolutePath];
    case 'line-column': {
      if (!hasLine) return [...baseArgs, absolutePath];
      const columnArgs = typeof column === 'number' ? ['--column', String(column)] : [];
      return [...baseArgs, '--line', String(line), ...columnArgs, absolutePath];
    }
    default:
      return [...baseArgs, absolutePath];
  }
}

/**
 * Editors whose commands exist on PATH. File Manager (`commands: null`) is skipped.
 * @param {{ execFile?: Function, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {Promise<{ id: string, label: string }[]>}
 */
async function listAvailableEditors(deps = {}) {
  const available = [];
  for (const editor of EDITORS) {
    if (editor.commands === null) continue;
    const command = await firstAvailableCommand(editor.commands, deps);
    if (command) available.push({ id: editor.id, label: editor.label });
  }
  return available;
}

/**
 * Launch a workspace file in a probed editor.
 * @param {{ editor: string, cwd: string, relativePath: string, line?: number, column?: number }} input
 * @param {{ spawn?: Function, execFile?: Function, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [deps]
 */
async function openInEditor(input = {}, deps = {}) {
  const def = EDITORS.find((item) => item.id === input.editor);
  if (!def) return fail(`Unknown editor: ${input.editor}`);
  if (!def.commands) return fail(`Unsupported editor: ${input.editor}`);
  const target = resolveInside(input.cwd, input.relativePath);
  if (!target) return fail('Path is outside the workspace.');
  const command = await firstAvailableCommand(def.commands, deps);
  if (!command) return fail(`Editor command not found: ${def.commands[0]}`);
  const args = resolveEditorArgs(def, target, input.line, input.column);
  try {
    const spawn = deps.spawn ?? nodeSpawn;
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (typeof child.unref === 'function') child.unref();
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to launch editor');
  }
}

function defaultShell() {
  return require('electron').shell;
}

/**
 * Reveal an absolute path in the OS file manager.
 * @param {string} absolutePath
 * @param {{ shell?: { showItemInFolder: Function } }} [deps]
 */
function showItemInFolder(absolutePath, deps = {}) {
  const electronShell = deps.shell ?? defaultShell();
  electronShell.showItemInFolder(absolutePath);
  return { ok: true };
}

/**
 * Resolve a workspace-relative path and reveal it in the file manager.
 * @param {string} cwd
 * @param {string} relativePath
 * @param {{ shell?: { showItemInFolder: Function } }} [deps]
 */
function revealInFolder(cwd, relativePath, deps = {}) {
  const target = resolveInside(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.');
  return showItemInFolder(target, deps);
}

/**
 * Open a workspace file with the OS default handler (`shell.openPath`).
 * @param {{ cwd: string, relativePath: string }} input
 * @param {{ shell?: { openPath: Function } }} [deps]
 */
async function openWithSystemDefault(input = {}, deps = {}) {
  const target = resolveInside(input.cwd, input.relativePath);
  if (!target) return fail('Path is outside the workspace.');
  const electronShell = deps.shell ?? defaultShell();
  try {
    const error = await electronShell.openPath(target);
    return error ? fail(error) : { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unable to open file');
  }
}

module.exports = {
  EDITORS,
  listAvailableEditors,
  openInEditor,
  showItemInFolder,
  revealInFolder,
  openWithSystemDefault,
  setWorkspaceAuthority,
};
