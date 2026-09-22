#!/usr/bin/env node
/**
 * Fail-closed release gate: require a successful CI workflow run for an exact SHA.
 *
 * Usage:
 *   node scripts/require-ci-green-for-sha.mjs --sha <full-sha> [--workflow ci.yml]
 *
 * Requires gh CLI auth. Fails on missing/failed/cancelled/pending runs.
 */
import { execFileSync } from "node:child_process";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const sha = arg("--sha") || process.env.GITHUB_SHA || null;
const workflow = arg("--workflow", "ci.yml");
if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) {
  console.error("require-ci-green-for-sha: --sha <commit> is required");
  process.exit(2);
}

function ghJson(args) {
  const out = execFileSync("gh", args, { encoding: "utf8" });
  return JSON.parse(out);
}

const runs = ghJson([
  "run",
  "list",
  "--workflow",
  workflow,
  "--json",
  "databaseId,headSha,status,conclusion,url,displayTitle,event",
  "--limit",
  "50",
]);

const matches = runs.filter((run) => String(run.headSha).toLowerCase() === sha.toLowerCase());
if (matches.length === 0) {
  console.error(`No CI runs found for sha ${sha} on workflow ${workflow}`);
  process.exit(1);
}

const success = matches.find((run) => run.status === "completed" && run.conclusion === "success");
if (!success) {
  console.error(
    `No successful CI run for sha ${sha}. Latest matches:\n` +
      matches
        .slice(0, 5)
        .map((run) => `- ${run.status}/${run.conclusion} ${run.url}`)
        .join("\n"),
  );
  process.exit(1);
}

console.log(`CI green for ${sha}: ${success.url}`);
