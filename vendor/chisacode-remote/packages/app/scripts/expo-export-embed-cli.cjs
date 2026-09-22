#!/usr/bin/env node

const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const entryFileFlagIndex = process.argv.indexOf("--entry-file");

if (entryFileFlagIndex >= 0) {
  const entryFileValueIndex = entryFileFlagIndex + 1;
  const entryFile = process.argv[entryFileValueIndex];

  if (entryFile && !path.isAbsolute(entryFile)) {
    process.argv[entryFileValueIndex] = path.resolve(appRoot, entryFile);
  }
}

const expoCli = require("@expo/cli/build/bin/cli");
void expoCli;
