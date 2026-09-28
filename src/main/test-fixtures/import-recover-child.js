// Child process: a fresh launch that runs cold-start recovery on the home a
// crashed import left behind, then reports the reconciled verdict + journal.
const fs = require('fs');
const [ , , userDataDir, destHome ] = process.argv;
const { setDesktopDshHome } = require('../../shared/dsh-home');
setDesktopDshHome(destHome);
const { recoverInterruptedImport, readImportJournal } = require('../data-import');
const outcome = recoverInterruptedImport({ userDataDir, destHome });
const journal = readImportJournal(userDataDir);
process.stdout.write(JSON.stringify({ outcome, journalPhase: journal ? journal.phase : null }));
process.exit(0);
