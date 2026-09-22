#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const rg = spawnSync("rg", ["--version"], { encoding: "utf8" });

if (rg.status !== 0) {
  console.error("localization audit requires rg on PATH");
  process.exit(1);
}

const targetRoots = ["packages/app/src", "packages/desktop/src", "packages/cli/src"];

const allowedLocalizationFiles = new Set([
  "packages/app/src/i18n/index.ts",
  "packages/desktop/src/i18n.ts",
  "packages/cli/src/i18n.ts",
]);

const skippedPathFragments = [
  "/dist/",
  "/node_modules/",
  "/docs/",
  "/posts/",
  "/assets/",
  "/terminal/",
  "/protocol/",
  "/client/",
  "/server/",
  "/__fixtures__/",
];

const skippedFilePatterns = [
  /\.d\.ts$/,
  /\.test\.[cm]?[tj]sx?$/,
  /\.spec\.[cm]?[tj]sx?$/,
  /\.gen\.[cm]?[tj]sx?$/,
  /terminal-emulator-webview-html\.ts$/,
  /react-devtools\.ts$/,
];

const allowedTerms = [
  "ChisaCode",
  "daemon",
  "workspace",
  "provider",
  "model",
  "PR",
  "issue",
  "CLI",
  "MCP",
  "worktree",
  "GitHub",
  "OpenAI",
  "Claude",
  "Codex",
  "Copilot",
  "OpenCode",
  "Cursor",
  "Gemini",
  "Windows",
  "Linux",
  "macOS",
  "iOS",
  "Android",
  "Web",
  "App Store",
  "Play Store",
  "AppImage",
  "DEB",
  "RPM",
  "JSON",
  "YAML",
  "URL",
  "HTTP",
  "HTTPS",
  "WebSocket",
  "Discord",
  "npm",
  "npx",
  "tsx",
  "localhost",
  "Homebrew",
  "Nix",
];

const allowedEnglishLiterals = new Set([
  "EN",
  "zh-CN",
  "en",
  "table",
  "json",
  "yaml",
  "tree",
  "main",
  "origin",
  "HEAD",
  "open",
  "closed",
  "running",
  "idle",
  "error",
  "success",
  "warning",
  "info",
  "stderr",
  "stdout",
  "pipe",
]);

const userVisiblePatterns = [
  {
    name: "jsx-text",
    regex: />\s*([^<>{}\n]*[\p{Script=Han}A-Za-z][^<>{}\n]*)\s*</gu,
  },
  {
    name: "jsx-prop",
    regex:
      /\b(?:accessibilityLabel|aria-label|placeholder|title|label|confirmLabel|cancelLabel|message|description|header|buttonLabel|openAccessibilityLabel|removeAccessibilityLabel)\s*=\s*(["'`])([^"'`\n]*[\p{Script=Han}A-Za-z][^"'`\n]*)\1/gu,
    group: 2,
  },
  {
    name: "object-copy",
    regex:
      /\b(?:accessibilityLabel|placeholder|title|label|confirmLabel|cancelLabel|message|description|header|buttonLabel|emptyText|loadingText|errorText)\s*:\s*(["'`])([^"'`\n]*[\p{Script=Han}A-Za-z][^"'`\n]*)\1/gu,
    group: 2,
  },
  {
    name: "commander-copy",
    regex:
      /\.(?:description|argument|option|requiredOption)\([^"'`\n]*(["'`])([^"'`\n]*[\p{Script=Han}A-Za-z][^"'`\n]*)\1/gu,
    group: 2,
  },
  {
    name: "alerts-toasts",
    regex:
      /\b(?:Alert\.alert|toast\.(?:show|error|copied)|ctx\.toast\.(?:show|error|copied)|console\.(?:log|error))\(\s*(["'`])([^"'`\n]*[\p{Script=Han}A-Za-z][^"'`\n]*)\1/gu,
    group: 2,
  },
  {
    name: "desktop-error",
    regex:
      /\b(?:throw new Error|return \{[^}\n]*error:)\s*\(?\s*(["'`])([^"'`\n]*[\p{Script=Han}A-Za-z][^"'`\n]*)\1/gu,
    group: 2,
  },
];

function runRg(args) {
  return spawnSync("rg", args, { cwd: root, encoding: "utf8" });
}

function normalizePath(file) {
  return file.split(path.sep).join("/");
}

function shouldSkipFile(file) {
  if (!/\.[cm]?[tj]sx?$/.test(file)) return true;
  if (allowedLocalizationFiles.has(file)) return true;
  if (skippedPathFragments.some((fragment) => file.includes(fragment))) return true;
  return skippedFilePatterns.some((pattern) => pattern.test(file));
}

function getSourceFiles() {
  const result = runRg(["--files", ...targetRoots]);
  if (result.status !== 0) {
    console.error(result.stderr.trim() || "failed to list source files");
    process.exit(1);
  }

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map(normalizePath)
    .filter((file) => !shouldSkipFile(file));
}

function getLineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function stripAllowedTerms(value) {
  let stripped = value;
  for (const term of allowedTerms) {
    stripped = stripped.replaceAll(term, "");
  }
  return stripped;
}

function hasEnglish(value) {
  if (allowedEnglishLiterals.has(value.trim())) return false;
  return /[A-Za-z]{3,}/.test(stripAllowedTerms(value));
}

function hasChinese(value) {
  return /\p{Script=Han}/u.test(value);
}

function isCodeLike(value) {
  const trimmed = value.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("(") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("<") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/") ||
    trimmed.includes("{{") ||
    trimmed.includes(" | ") ||
    /^[A-Z][A-Z0-9 _/-]+$/.test(trimmed) ||
    /^[A-Za-z0-9_.]+$/.test(trimmed) ||
    /^[A-Z0-9_./:-]+$/.test(trimmed) ||
    /^[a-z0-9_.:/-]+$/.test(trimmed)
  );
}

function collectFindings(files) {
  const english = [];
  const chinese = [];

  for (const file of files) {
    const fullPath = path.join(root, file);
    const source = readFileSync(fullPath, "utf8");

    for (const pattern of userVisiblePatterns) {
      pattern.regex.lastIndex = 0;
      for (const match of source.matchAll(pattern.regex)) {
        const value = (match[pattern.group ?? 1] ?? "").trim();
        if (isCodeLike(value)) continue;
        const line = getLineNumber(source, match.index ?? 0);
        const finding = `${file}:${line}: ${value}`;
        if (hasEnglish(value)) english.push(finding);
        if (hasChinese(value)) chinese.push(finding);
      }
    }
  }

  return { english, chinese };
}

const findings = collectFindings(getSourceFiles());
let failed = false;

if (findings.english.length > 0) {
  failed = true;
  console.error("Potential user-visible English outside localization resources:");
  console.error(findings.english.slice(0, 120).join("\n"));
  if (findings.english.length > 120) {
    console.error(`...and ${findings.english.length - 120} more`);
  }
}

if (findings.chinese.length > 0) {
  failed = true;
  console.error("Hardcoded Chinese outside localization resources or explicit exemptions:");
  console.error(findings.chinese.slice(0, 120).join("\n"));
  if (findings.chinese.length > 120) {
    console.error(`...and ${findings.chinese.length - 120} more`);
  }
}

if (failed && strict) {
  process.exit(1);
}

console.log(failed ? "Localization audit completed with findings." : "Localization audit passed.");
