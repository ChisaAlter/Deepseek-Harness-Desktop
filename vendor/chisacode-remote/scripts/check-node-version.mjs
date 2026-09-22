#!/usr/bin/env node

const actual = process.version.replace(/^v/, "");
const major = Number.parseInt(actual.split(".")[0] ?? "0", 10);

console.log(`Active Node.js version: v${actual}`);
if (major < 22) {
  console.error("ChisaCode requires Node.js 22 or newer.");
  process.exitCode = 1;
} else {
  console.log("Node.js meets the minimum supported version (22).");
}
