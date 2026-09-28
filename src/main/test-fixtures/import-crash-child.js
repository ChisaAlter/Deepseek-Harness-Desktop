// Child process: run the REAL importer (importSessions -> copyDirAtomic ->
// replaceDirJournaled -> commitStagedDir) and crash at a chosen transaction
// checkpoint. Two crash knobs:
//   CRASH_AFTER_JOURNAL=N — exit after the Nth journal writeJsonAtomic
//     rename (1=staged, 2=replacing, 3=committed): models a crash between
//     recorded transaction states.
//   CRASH_AFTER_RENAMES=N — exit after the Nth fs.promises.rename
//     (1=dest->bak, 2=tmp->dest): models a crash mid directory swap.
// Leaves journal + staged tmp/bak on disk exactly as a mid-transaction
// crash would. Parent recovers in a separate process.
const fs = require('fs');
const path = require('path');

const [ , , sourceHome, destHome, userDataDir, crashAfterRenames, crashAfterJournal ] = process.argv;
const renameLimit = Number(crashAfterRenames || '0');
const journalLimit = Number(crashAfterJournal || '0');

if (journalLimit > 0) {
  const realRenameSync = fs.renameSync.bind(fs);
  let journalWrites = 0;
  fs.renameSync = (a, b) => {
    const out = realRenameSync(a, b);
    // Count only transaction-journal writes, not unrelated renames.
    if (String(b).includes('.import-txn-')) {
      journalWrites += 1;
      if (journalWrites >= journalLimit) process.exit(9);
    }
    return out;
  };
}
if (renameLimit > 0) {
  const realRename = fs.promises.rename.bind(fs.promises);
  let renames = 0;
  fs.promises.rename = async (a, b) => {
    const out = await realRename(a, b);
    renames += 1;
    if (renames >= renameLimit) process.exit(9);
    return out;
  };
}

const { setDesktopDshHome } = require('../../shared/dsh-home');
setDesktopDshHome(destHome);
const { importSessions } = require('../data-import');

(async () => {
  try {
    const result = await importSessions({
      sourceHome,
      destHome,
      selectedRels: ['proj/sess-a'],
      userDataDir,
      importAttachments: true,
      overwrite: true,
    });
    process.stdout.write(JSON.stringify({ exit: 'completed', ok: result.ok }));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stdout.write(JSON.stringify({ exit: 'threw', error: error.message }));
    process.exit(2);
  }
})();
