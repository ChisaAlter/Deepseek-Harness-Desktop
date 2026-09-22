import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rootPackagePath = path.join(rootDir, "package.json");

function usageAndExit(code = 0) {
  process.stderr.write(`Usage: node scripts/push-current-release-tag.mjs [--branch <name>]\n`);
  process.exit(code);
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: rootDir, stdio: "inherit" });
}

function runQuiet(cmd, args) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
}

function getRemoteTagCommit(tag) {
  try {
    return runQuiet("git", ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}^{}`])
      .split(/\s+/)[0]
      .trim();
  } catch {
    try {
      return runQuiet("git", ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`])
        .split(/\s+/)[0]
        .trim();
    } catch {
      return "";
    }
  }
}

function parseArgs(argv) {
  const args = {
    branch: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") {
      args.branch = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit(1);
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const version = typeof rootPackage.version === "string" ? rootPackage.version.trim() : "";
if (!version) {
  throw new Error('Root package.json must contain a valid "version"');
}

const tag = `v${version}`;
const headCommit = runQuiet("git", ["rev-parse", "HEAD"]);
const __ciGate = spawnSync(
  process.execPath,
  ["scripts/require-ci-green-for-sha.mjs", "--sha", headCommit],
  { stdio: "inherit" },
);
if (__ciGate.status !== 0) {
  throw new Error(`CI exact-SHA gate failed for ${headCommit}`);
}

let localTagCommit = "";
try {
  localTagCommit = runQuiet("git", ["rev-list", "-n", "1", tag]);
} catch {
  run("git", ["tag", "-a", tag, "-m", tag]);
  localTagCommit = runQuiet("git", ["rev-list", "-n", "1", tag]);
}

if (localTagCommit !== headCommit) {
  throw new Error(
    `Local tag ${tag} points to ${localTagCommit}, but HEAD is ${headCommit}. ` +
      "Create a new release commit before pushing this tag.",
  );
}

const currentBranch = runQuiet("git", ["branch", "--show-current"]);
const branchRef = args.branch || currentBranch;
if (!branchRef) {
  throw new Error("Cannot determine branch to push. Pass --branch <name>.");
}
run("git", ["push", "origin", `HEAD:${branchRef}`]);

const remoteTagCommit = getRemoteTagCommit(tag);

if (remoteTagCommit) {
  if (remoteTagCommit !== localTagCommit) {
    throw new Error(
      `Remote tag ${tag} points to ${remoteTagCommit}, but local tag points to ${localTagCommit}. ` +
        "Refusing to reuse an existing release tag for a different commit.",
    );
  }
  console.log(`Tag ${tag} already exists on origin`);
} else {
  run("git", ["push", "origin", tag]);
}

console.log(`Release push complete: branch HEAD and tag ${tag}`);
