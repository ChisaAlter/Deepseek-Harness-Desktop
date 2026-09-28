'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Journaled directory replacement: stages the new tree under a unique
 * `<dest>.import-tmp-<opId>` name, persists intent to a per-operation
 * journal file, renames the live destination to `<dest>.import-bak-<opId>`,
 * moves staging into place, records the commit, and only then removes the
 * backup. A crash at any point leaves at least one intact copy on disk and
 * enough journal state for `recoverImportTransactions()` to reconcile it.
 *
 * This replaces the older `copyDirAtomic()` which deleted the destination
 * before renaming staging: a crash inside that window left neither the old
 * nor the new tree, and the recovery sweep then deleted the only remaining
 * copy (the staging dir).
 */

const JOURNAL_VERSION = 1;
const TMP_SUFFIX = '.import-tmp';
const BAK_SUFFIX = '.import-bak';
const TXN_SUFFIX = '.import-txn';

function tmpName(dest, opId) { return `${dest}${TMP_SUFFIX}-${opId}`; }
function bakName(dest, opId) { return `${dest}${BAK_SUFFIX}-${opId}`; }
function txnName(dest, opId) { return `${dest}${TXN_SUFFIX}-${opId}`; }

let opCounter = 0;
function nextOpId() {
  opCounter += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${opCounter.toString(36)}`;
}

function samePath(left, right) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(root, child) {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function pathExists(p) {
  try { await fs.promises.lstat(p); return true; } catch { return false; }
}

/**
 * Copy `from` into `staging` file-by-file so that a destination tree can be
 * overlaid instead of replaced (used for the attachment merge).
 * @param {string} from
 * @param {string} staging
 * @param {{ overwrite?: boolean, preserve?: boolean }} [opts]
 *   `overwrite: false` keeps an existing staged file when the source has the
 *   same relative path. `preserve` is informational only.
 */
async function overlayDir(from, staging, { overwrite = true } = {}) {
  const entries = await fs.promises.readdir(from, { withFileTypes: true });
  await fs.promises.mkdir(staging, { recursive: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(staging, entry.name);
    if (entry.isDirectory()) {
      await overlayDir(src, dst, { overwrite });
    } else if (entry.isSymbolicLink()) {
      // Symlinked trees are skipped rather than silently followed outside the
      // attachment root; import sources are user homes, not trusted packages.
      continue;
    } else if (entry.isFile()) {
      const exists = await pathExists(dst);
      if (exists && !overwrite) continue;
      await fs.promises.copyFile(src, dst);
    }
  }
}

/**
 * Commit an already-staged directory into `dest` as the second half of the
 * journaled transaction: dest -> bak, staging -> dest, record commit,
 * drop backup. Callers that need a pre-populated staging tree (the
 * attachment merge) build it themselves and then call this.
 */
async function commitStagedDir(stagingDir, dest, { opId } = {}) {
  const id = opId || nextOpId();
  const tmp = stagingDir;
  const bak = bakName(dest, id);
  const txnFile = txnName(dest, id);
  const baseJournal = {
    version: JOURNAL_VERSION,
    opId: id,
    dest: path.resolve(dest),
    tmp: path.resolve(tmp),
    bak: path.resolve(bak),
    state: 'staged',
    startedAt: new Date().toISOString(),
  };
  const destParent = path.dirname(dest);
  if (!isInside(destParent, tmp) || !isInside(destParent, bak)) {
    return { ok: false, opId: id, error: 'unsafe-destination' };
  }
  try {
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'staged' });
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'replacing' });
    const hadDest = await pathExists(dest);
    if (hadDest) {
      await fs.promises.rename(dest, bak);
    }
    try {
      await fs.promises.rename(tmp, dest);
    } catch (renameError) {
      if (hadDest) {
        try {
          await fs.promises.rename(bak, dest);
        } catch (restoreError) {
          writeJsonAtomic(txnFile, {
            ...baseJournal,
            state: 'needsRecovery',
            error: `rename failed and restore failed: ${renameError.message}; ${restoreError.message}`,
          });
          return { ok: false, opId: id, needsRecovery: true, error: renameError.message };
        }
      }
      writeJsonAtomic(txnFile, { ...baseJournal, state: 'rolledBack', error: renameError.message });
      await fs.promises.rm(txnFile, { force: true });
      return { ok: false, opId: id, error: renameError.message };
    }
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'committed', hadDest });
    if (hadDest) {
      await fs.promises.rm(bak, { recursive: true, force: true });
    }
    await fs.promises.rm(txnFile, { force: true });
    return { ok: true, opId: id };
  } catch (error) {
    writeJsonAtomic(txnFile, {
      ...baseJournal,
      state: 'needsRecovery',
      error: error.message || String(error),
    });
    return { ok: false, opId: id, needsRecovery: true, error: error.message || String(error) };
  }
}

/**
 * Transactionally replace the directory at `dest` with the contents of
 * `from`: stages `from` under the transaction tmp name first, then commits.
 */
async function replaceDirJournaled(from, dest, { opId } = {}) {
  const id = opId || nextOpId();
  const tmp = tmpName(dest, id);
  if (samePath(from, dest) || isInside(from, dest) || isInside(dest, from)) {
    return { ok: false, opId: id, error: 'source-dest-overlap' };
  }
  try {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.cp(from, tmp, { recursive: true, verbatimSymlinks: false });
  } catch (error) {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    return { ok: false, opId: id, error: error.message || String(error) };
  }
  return commitStagedDir(tmp, dest, { opId: id });
}

/**
 * Reconcile per-operation transaction journals left under `root`'s children.
 * Returns `{ recovered, pending, removedTmp }`; `pending` lists opIds whose
 * state could not be reconciled automatically and must block re-import.
 *
 * Rules:
 * - `staged`/`staging`: tmp still exists and dest untouched -> drop tmp.
 * - `replacing`: tmp may or may not have moved; prefer restoring `bak` when
 *   dest is missing, else keep committed dest and drop `bak`.
 * - `committed`: remove `bak` if still present.
 * - `needsRecovery` / unreadable: leave in place and report as pending.
 * - Bare `*.import-tmp` (legacy crash artifacts without a journal) are
 *   preserved: they may be the only surviving copy.
 */
async function recoverImportTransactions(root, { onPending } = {}) {
  const recovered = [];
  const pending = [];
  const removedTmp = [];
  if (!root || !fs.existsSync(root)) {
    return { recovered, pending, removedTmp };
  }
  const parent = path.dirname(root.replace(/[\\/]+$/, ''));
  const destName = path.basename(root);
  let siblings;
  try {
    siblings = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return { recovered, pending, removedTmp };
  }
  const txnFiles = siblings.filter((e) => e.isFile() && e.name.startsWith(`${destName}${TXN_SUFFIX}-`));
  for (const entry of txnFiles) {
    const txnPath = path.join(parent, entry.name);
    const journal = readJson(txnPath);
    const opId = entry.name.slice(`${destName}${TXN_SUFFIX}-`.length);
    if (!journal || journal.version !== JOURNAL_VERSION) {
      pending.push({ opId, reason: 'unreadable-journal' });
      continue;
    }
    const dest = journal.dest;
    const tmp = journal.tmp;
    const bak = journal.bak;
    try {
      if (journal.state === 'staging' || journal.state === 'staged') {
        await fs.promises.rm(tmp, { recursive: true, force: true });
        removedTmp.push(tmp);
        fs.rmSync(txnPath, { force: true });
        recovered.push(opId);
      } else if (journal.state === 'replacing') {
        const destThere = await pathExists(dest);
        const tmpThere = await pathExists(tmp);
        const bakThere = await pathExists(bak);
        if (!destThere && tmpThere) {
          // Crash between the renames: finish the commit.
          await fs.promises.rename(tmp, dest);
          if (bakThere) await fs.promises.rm(bak, { recursive: true, force: true });
        } else if (!destThere && bakThere) {
          // tmp vanished (or rename to dest failed pre-crash): restore old.
          await fs.promises.rename(bak, dest);
          if (tmpThere) { await fs.promises.rm(tmp, { recursive: true, force: true }); removedTmp.push(tmp); }
        } else if (destThere && bakThere) {
          // Commit landed before crash: drop the backup.
          await fs.promises.rm(bak, { recursive: true, force: true });
          if (tmpThere) { await fs.promises.rm(tmp, { recursive: true, force: true }); removedTmp.push(tmp); }
        }
        fs.rmSync(txnPath, { force: true });
        recovered.push(opId);
      } else if (journal.state === 'committed') {
        if (await pathExists(bak)) {
          await fs.promises.rm(bak, { recursive: true, force: true });
        }
        fs.rmSync(txnPath, { force: true });
        recovered.push(opId);
      } else {
        pending.push({ opId, reason: journal.state || 'unknown' });
      }
    } catch (error) {
      pending.push({ opId, reason: error.message || String(error) });
    }
  }
  // Legacy bare staging dirs (no journal): preserve rather than delete —
  // they may hold the only copy of the user's data.
  for (const entry of siblings) {
    if (entry.isDirectory() && entry.name.startsWith(`${destName}${TMP_SUFFIX}`)) {
      const hasTxn = txnFiles.some((t) => t.name === `${destName}${TXN_SUFFIX}-${entry.name.slice(destName.length + TMP_SUFFIX.length + 1)}`);
      if (!hasTxn) {
        pending.push({ opId: `legacy:${entry.name}`, reason: 'unjournaled-staging-preserved' });
      }
    }
    if (entry.isDirectory() && entry.name.startsWith(`${destName}${BAK_SUFFIX}`)) {
      pending.push({ opId: `legacy:${entry.name}`, reason: 'unjournaled-backup-preserved' });
    }
  }
  if (typeof onPending === 'function') {
    for (const p of pending) onPending(p);
  }
  return { recovered, pending, removedTmp };
}

module.exports = {
  replaceDirJournaled,
  commitStagedDir,
  recoverImportTransactions,
  overlayDir,
  nextOpId,
  TMP_SUFFIX,
  BAK_SUFFIX,
  TXN_SUFFIX,
};
