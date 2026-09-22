const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const originalCwd = process.cwd();
const [cliFile, ...rawArgs] = process.argv.slice(2);

if (!cliFile) {
  console.error("Missing Expo CLI path.");
  process.exit(1);
}

const pathFlags = new Set(["--assets-dest", "--bundle-output", "--config", "--sourcemap-output"]);
const cliFilePath = path.isAbsolute(cliFile) ? cliFile : path.resolve(originalCwd, cliFile);

if (rawArgs[0] !== "export:embed") {
  const result = spawnSync(process.execPath, [cliFile, ...rawArgs], {
    cwd: originalCwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === "--entry-file") {
    args.push(arg, path.join(projectRoot, "index.ts"));
    index += 1;
    continue;
  }

  if (pathFlags.has(arg) && rawArgs[index + 1]) {
    const value = rawArgs[index + 1];
    args.push(arg, path.isAbsolute(value) ? value : path.resolve(originalCwd, value));
    index += 1;
    continue;
  }

  args.push(arg);
}

const result = spawnSync(process.execPath, [cliFilePath, ...args], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
