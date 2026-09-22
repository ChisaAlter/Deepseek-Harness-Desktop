import { getErrorMessage } from "./utils/errors.js";
import { runCli } from "./run.js";

// Global safety nets so an unhandled rejection or stray throw never escapes
// as an unfiltered stack trace (which may include environment-derived paths or
// other sensitive context) to stderr. We normalise the message via
// getErrorMessage and force a non-zero exit code.
process.on("unhandledRejection", (error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exitCode = 1;
});

// Per Node's guidance, an uncaughtException means the process is in an
// undefined state and must not keep running. We log the normalised message and
// exit with code 1. (unhandledRejection above is left non-fatal so an
// unrelated background rejection does not abort an interactive command such
// as `onboard` or `agent attach`.)
//
// Trade-off: `process.exit` does not wait for async stderr to flush, so when
// stderr is redirected to a pipe/file (e.g. CI logs) the final error line can
// be truncated. We accept this for the CLI because uncaughtException is
// extremely rare, TTY output (the common case) is synchronous, and the
// alternative (only setting exitCode) leaves the process running in a
// corrupted state, which is worse.
process.on("uncaughtException", (error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
});

try {
  const exitCode = await runCli(process.argv.slice(2), {
    nodeArgv: [process.argv[0] ?? "node", process.argv[1] ?? "chisacode"],
  });
  process.exitCode = exitCode;
} catch (error) {
  // Covers action handlers that bypass the withOutput wrapper and re-throw
  // (e.g. onboard cancellation paths), plus commander's own CommanderError.
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exitCode = 1;
}
