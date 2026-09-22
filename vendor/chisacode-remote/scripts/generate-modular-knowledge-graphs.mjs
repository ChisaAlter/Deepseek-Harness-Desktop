#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "docs", "knowledge-graphs");
const MODULE_DOC_ROOT = path.join(ROOT, "docs", "modules");
const UNDERSTAND_ROOT = path.join(ROOT, ".understand-anything");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".scss",
]);

const IGNORE_DIRS = new Set([
  ".git",
  ".expo",
  ".next",
  ".turbo",
  "android",
  "build",
  "coverage",
  "dist",
  "ios",
  "node_modules",
  "release",
  "web-build",
]);

const MODULE_DESCRIPTIONS = {
  app: "Expo React Native client for mobile, browser web, and the desktop renderer UI.",
  cli: "Commander-based command-line client for daemon, agent, chat, terminal, loop, schedule, provider, and worktree workflows.",
  client:
    "Shared daemon WebSocket driver and ChisaCodeClient facade consumed by app, CLI, and SDK-shaped code.",
  desktop:
    "Electron wrapper that can spawn and manage a local daemon and host the exported web renderer.",
  "expo-two-way-audio":
    "Native Expo module that bridges two-way audio streaming for realtime voice features.",
  highlight: "Shared syntax highlighting utilities used by client-facing packages.",
  protocol:
    "Shared wire schemas, protocol constants, binary frame codecs, and compatibility contract.",
  relay: "End-to-end encrypted relay package for remote client-to-daemon connectivity.",
  server:
    "Local daemon that owns agent lifecycle, WebSocket sessions, persistence, provider adapters, MCP, relay, and runtime services.",
};

const MODULE_OWNERSHIP = {
  protocol: [
    "WebSocket message schemas",
    "provider config schemas",
    "binary frame codecs",
    "append-only compatibility rules",
  ],
  client: [
    "daemon WebSocket transport",
    "request/response correlation",
    "relay E2EE client transport",
    "SDK facade boundaries",
  ],
  server: [
    "daemon bootstrap and session routing",
    "agent lifecycle and timeline storage",
    "provider runtime adapters",
    "MCP server and local services",
  ],
  app: [
    "cross-platform React Native UI",
    "host/session runtime state",
    "workspace and agent screens",
    "composer, voice, settings, and desktop renderer UI",
  ],
  cli: [
    "terminal command surface",
    "daemon control commands",
    "agent import/run/log workflows",
    "machine-readable output renderers",
  ],
  desktop: [
    "Electron main/preload processes",
    "managed daemon subprocess",
    "desktop-specific routing and windows",
    "renderer export packaging",
  ],
  relay: [
    "encrypted client/daemon channels",
    "relay server adapters",
    "handshake and crypto primitives",
    "remote connectivity threat boundary",
  ],
  highlight: [
    "syntax tokenization",
    "shared highlighting output",
    "renderer-safe code display support",
  ],
  "expo-two-way-audio": [
    "native audio module surface",
    "iOS/Android two-way streaming bridge",
    "Expo module packaging",
  ],
};

const CROSS_CUTTING_TOPICS = [
  {
    id: "provider-plumbing",
    title: "Provider Plumbing",
    modules: ["protocol", "server", "client", "app", "cli"],
    docs: ["docs/providers.md", "docs/custom-providers.md"],
    reason:
      "Provider changes usually cross manifest/config schemas, daemon runtime adapters, app settings, client requests, and verification paths.",
  },
  {
    id: "daemon-agent-lifecycle",
    title: "Daemon And Agent Lifecycle",
    modules: ["server", "protocol", "client", "app", "cli", "desktop"],
    docs: ["docs/architecture.md", "docs/agent-lifecycle.md", "docs/data-model.md"],
    reason:
      "Agent state is daemon-owned, protocol-visible, client-consumed, and surfaced through app/CLI/desktop workflows.",
  },
  {
    id: "websocket-rpc-protocol",
    title: "WebSocket RPC Protocol",
    modules: ["protocol", "server", "client", "app", "cli", "desktop"],
    docs: ["docs/rpc-namespacing.md", "docs/architecture.md"],
    reason:
      "New RPCs must be schema-compatible, server-routed, client-correlated, and UI/CLI-consumed through one wire contract.",
  },
  {
    id: "desktop-daemon-spawn",
    title: "Desktop Daemon Spawn",
    modules: ["desktop", "server", "app", "client", "protocol"],
    docs: ["docs/development.md", "docs/architecture.md"],
    reason:
      "Desktop behavior crosses Electron main/preload code, exported web app, daemon process management, and local WebSocket transport.",
  },
  {
    id: "app-platform-boundaries",
    title: "App Platform Boundaries",
    modules: ["app", "desktop", "expo-two-way-audio", "client", "protocol"],
    docs: [
      "docs/coding-standards.md",
      "docs/hover.md",
      "docs/unistyles.md",
      "docs/floating-panels.md",
    ],
    reason:
      "App code must remain native/web/electron safe while still sharing host/session state and client protocol behavior.",
  },
  {
    id: "relay-security-boundaries",
    title: "Relay Security Boundaries",
    modules: ["relay", "server", "client", "app", "desktop"],
    docs: ["SECURITY.md", "docs/architecture.md"],
    reason:
      "Relay work changes E2EE transport assumptions across daemon, client transport, pairing, and remote access UX.",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toRel(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function lineCount(content) {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith("release")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }

  return results.sort((a, b) => toRel(a).localeCompare(toRel(b)));
}

function packageIdFromName(packageName, fallback) {
  if (!packageName) {
    return fallback;
  }
  return packageName.replace(/^@chisacode\//, "");
}

function categorizeFile(relPath) {
  const base = path.basename(relPath);
  const ext = path.extname(base);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) {
    return "test";
  }
  if (base === "package.json" || base.startsWith("tsconfig") || base.includes("config")) {
    return "config";
  }
  if (ext === ".md") {
    return "docs";
  }
  if ([".yml", ".yaml", ".toml", ".json"].includes(ext)) {
    return "config";
  }
  if (relPath.includes("/src/")) {
    return "source";
  }
  return "support";
}

function extractImports(content) {
  const imports = [];
  const source = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push(match[1]);
    }
  }

  return [...new Set(imports)].sort();
}

function resolveRelativeImport(fromFile, specifier, moduleRoot) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
    return null;
  }

  const basePath = specifier.startsWith("@/")
    ? path.join(moduleRoot, "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const withoutJsExtension = basePath.replace(/\.[cm]?jsx?$/, "");

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.web.ts`,
    `${basePath}.web.tsx`,
    `${basePath}.native.ts`,
    `${basePath}.native.tsx`,
    `${basePath}.electron.ts`,
    `${basePath}.electron.tsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${withoutJsExtension}.js`,
    `${withoutJsExtension}.jsx`,
    `${withoutJsExtension}.web.ts`,
    `${withoutJsExtension}.web.tsx`,
    `${withoutJsExtension}.native.ts`,
    `${withoutJsExtension}.native.tsx`,
    `${withoutJsExtension}.electron.ts`,
    `${withoutJsExtension}.electron.tsx`,
    `${withoutJsExtension}.mjs`,
    `${withoutJsExtension}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toRel(candidate);
    }
  }

  return null;
}

function externalPackageName(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return `${scope}/${name}`;
  }
  return specifier.split("/")[0];
}

function collectWorkspaceModules() {
  const rootPackage = readJson(path.join(ROOT, "package.json"));
  const modules = [];

  for (const workspace of rootPackage.workspaces ?? []) {
    const packageDir = path.join(ROOT, workspace);
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJson(packageJsonPath);
    const id = packageIdFromName(packageJson.name, path.basename(packageDir));
    modules.push({
      id,
      packageName: packageJson.name,
      path: toRel(packageDir),
      absolutePath: packageDir,
      description: packageJson.description || MODULE_DESCRIPTIONS[id] || "",
      packageJson,
    });
  }

  return modules.sort((a, b) => a.id.localeCompare(b.id));
}

function analyzeModule(module, packageNameToModuleId) {
  const files = walkFiles(module.absolutePath);
  const nodes = [];
  const edges = [];
  const workspaceDeps = new Set();
  const externalDeps = new Set();
  const unresolvedInternalImports = [];

  for (const file of files) {
    const relPath = toRel(file);
    const content = fs.readFileSync(file, "utf8");
    const category = categorizeFile(relPath);
    const imports = extractImports(content);

    nodes.push({
      id: `file:${relPath}`,
      type: category,
      path: relPath,
      lines: lineCount(content),
      imports,
    });

    for (const specifier of imports) {
      const relativeTarget = resolveRelativeImport(file, specifier, module.absolutePath);
      if (relativeTarget) {
        edges.push({
          source: `file:${relPath}`,
          target: `file:${relativeTarget}`,
          type: "imports",
          specifier,
        });
        continue;
      }

      if (specifier.startsWith(".")) {
        unresolvedInternalImports.push({ from: relPath, specifier });
        continue;
      }

      const packageName = externalPackageName(specifier);
      const workspaceTarget = packageNameToModuleId.get(packageName);
      if (workspaceTarget && workspaceTarget !== module.id) {
        workspaceDeps.add(workspaceTarget);
        edges.push({
          source: `module:${module.id}`,
          target: `module:${workspaceTarget}`,
          type: "depends_on",
          specifier,
        });
        continue;
      }

      if (!specifier.startsWith("@/")) {
        externalDeps.add(packageName);
      }
    }
  }

  const categoryCounts = nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    generator: "scripts/generate-modular-knowledge-graphs.mjs",
    module: {
      id: module.id,
      packageName: module.packageName,
      path: module.path,
      description: module.description,
      ownership: MODULE_OWNERSHIP[module.id] ?? [],
    },
    entrypoints: {
      main: module.packageJson.main ?? null,
      types: module.packageJson.types ?? null,
      exports: module.packageJson.exports ?? null,
      scripts: module.packageJson.scripts ?? {},
    },
    stats: {
      files: nodes.length,
      categories: categoryCounts,
      internalImportEdges: edges.filter((edge) => edge.type === "imports").length,
      workspaceDependencies: [...workspaceDeps].sort(),
      externalDependencies: [...externalDeps].sort(),
      unresolvedInternalImports: unresolvedInternalImports.length,
    },
    nodes,
    edges,
    unresolvedInternalImports,
  };
}

function buildProjectGraph(modules, moduleGraphs) {
  const reverseDeps = new Map(modules.map((module) => [module.id, []]));
  const moduleEdges = [];

  for (const graph of moduleGraphs.values()) {
    for (const dependency of graph.stats.workspaceDependencies) {
      reverseDeps.get(dependency)?.push(graph.module.id);
      moduleEdges.push({
        source: `module:${graph.module.id}`,
        target: `module:${dependency}`,
        type: "depends_on",
      });
    }
  }

  const rootPackage = readJson(path.join(ROOT, "package.json"));
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    generator: "scripts/generate-modular-knowledge-graphs.mjs",
    project: {
      name: rootPackage.name,
      description: rootPackage.description,
      packageManager: "npm workspaces",
      moduleCount: modules.length,
    },
    modules: modules.map((module) => {
      const graph = moduleGraphs.get(module.id);
      return {
        id: module.id,
        packageName: module.packageName,
        path: module.path,
        description: module.description,
        ownership: MODULE_OWNERSHIP[module.id] ?? [],
        graphPath: `docs/modules/${module.id}/knowledge-graph.json`,
        handoffPath: `docs/modules/${module.id}/README.md`,
        dependsOn: graph.stats.workspaceDependencies,
        dependedOnBy: [...(reverseDeps.get(module.id) ?? [])].sort(),
        fileCount: graph.stats.files,
        categories: graph.stats.categories,
      };
    }),
    edges: moduleEdges.sort((a, b) =>
      `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`),
    ),
    crossCuttingTopics: CROSS_CUTTING_TOPICS,
  };
}

function main() {
  const modules = collectWorkspaceModules();
  const packageNameToModuleId = new Map(modules.map((module) => [module.packageName, module.id]));
  const moduleGraphs = new Map();

  for (const module of modules) {
    const graph = analyzeModule(module, packageNameToModuleId);
    moduleGraphs.set(module.id, graph);
    writeJson(path.join(MODULE_DOC_ROOT, module.id, "knowledge-graph.json"), graph);
  }

  const projectGraph = buildProjectGraph(modules, moduleGraphs);
  writeJson(path.join(OUTPUT_ROOT, "project-knowledge-graph.json"), projectGraph);
  writeJson(path.join(UNDERSTAND_ROOT, "knowledge-graph.json"), projectGraph);
  writeJson(path.join(UNDERSTAND_ROOT, "modular-index.json"), {
    version: "1.0.0",
    generatedAt: projectGraph.generatedAt,
    projectGraph: "docs/knowledge-graphs/project-knowledge-graph.json",
    moduleGraphs: projectGraph.modules.map((module) => ({
      id: module.id,
      path: module.graphPath,
    })),
  });

  console.log(
    `Generated modular knowledge graphs for ${modules.length} modules at docs/knowledge-graphs and docs/modules.`,
  );
}

main();
