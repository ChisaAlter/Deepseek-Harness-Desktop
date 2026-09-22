/**
 * Project Context — automatic project structure discovery and knowledge
 * injection into agent system prompts.
 *
 * Scans a workspace directory for modules (npm workspaces, top-level source
 * directories), reads their package.json metadata, and produces a compact
 * TOC string that gets injected into agent system prompts. This eliminates
 * the "cold start" problem where every new agent session must re-discover
 * the project structure from scratch.
 *
 * Knowledge files are cached in $CHISACODE_HOME/context/{hash}.md and
 * refreshed when the workspace's package.json changes.
 *
 * Design adapted from Cindy's packages/project-context (Apache-2.0).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface DiscoveredModule {
  /** Directory name relative to workspace root. */
  dir: string;
  /** Package name from package.json, or directory name if absent. */
  name: string;
  /** Package description, if available. */
  description?: string;
}

export interface ProjectContext {
  /** Workspace root path. */
  workDir: string;
  /** Workspace name (from root package.json). */
  projectName: string;
  /** Discovered modules. */
  modules: DiscoveredModule[];
  /** Compact TOC for system prompt injection. */
  toc: string;
  /** Unix ms when this context was built. */
  builtAt: number;
}

/** Hash a workspace path to a stable cache key. */
export function workspaceCacheKey(workDir: string): string {
  return createHash("sha256").update(workDir).digest("hex").slice(0, 16);
}

/**
 * Discover modules in a workspace directory.
 *
 * Strategy:
 * 1. Read root package.json for workspaces globs and project name
 * 2. For each workspace directory, read its package.json name/description
 * 3. Fall back to directory listing if no package.json workspaces
 */
export function discoverModules(workDir: string): DiscoveredModule[] {
  const rootPkg = readPackageJson(workDir);
  if (!rootPkg) return [];

  const workspaceGlobs = extractWorkspaceGlobs(rootPkg);
  if (workspaceGlobs.length > 0) {
    return discoverFromGlobs(workDir, workspaceGlobs);
  }

  return discoverFromDirectoryListing(workDir);
}

/**
 * Build the full project context for a workspace, including the TOC string
 * ready for system prompt injection.
 */
export function buildProjectContext(workDir: string, now: number = Date.now()): ProjectContext {
  const rootPkg = readPackageJson(workDir);
  const projectName = (rootPkg?.name as string | undefined) ?? path.basename(workDir);
  const modules = discoverModules(workDir);
  const toc = renderToc(projectName, modules);

  return { workDir, projectName, modules, toc, builtAt: now };
}

/**
 * Load a cached project context, or build and cache a fresh one.
 * Cache is invalidated when the root package.json mtime changes.
 */
export function loadProjectContext(workDir: string, cacheDir: string): ProjectContext {
  const key = workspaceCacheKey(workDir);
  const cachePath = path.join(cacheDir, `${key}.json`);

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as ProjectContext & {
        pkgMtime?: number;
      };
      const currentMtime = pkgMtime(workDir);
      if (cached.pkgMtime === currentMtime) {
        return cached;
      }
    } catch {
      // Corrupted cache — rebuild
    }
  }

  const context = buildProjectContext(workDir);
  const enriched = { ...context, pkgMtime: pkgMtime(workDir) };

  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(enriched, null, 2), "utf8");
  } catch {
    // Cache write failure is non-fatal
  }

  return context;
}

// ── Internals ──────────────────────────────────────────────────────────────

function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function pkgMtime(dir: string): number {
  try {
    const { mtimeMs } = statSync(path.join(dir, "package.json"));
    return mtimeMs;
  } catch {
    return 0;
  }
}

function extractWorkspaceGlobs(pkg: Record<string, unknown>): string[] {
  const workspaces = pkg.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((w): w is string => typeof w === "string");
  }
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const packages = (workspaces as Record<string, unknown>).packages;
    if (Array.isArray(packages)) {
      return packages.filter((p): p is string => typeof p === "string");
    }
  }
  return [];
}

function discoverFromGlobs(workDir: string, globs: string[]): DiscoveredModule[] {
  const modules: DiscoveredModule[] = [];

  for (const glob of globs) {
    // Handle simple "packages/*" style globs
    const base = glob.replace(/\/\*+$/, "");
    const baseDir = path.join(workDir, base);

    if (!existsSync(baseDir)) continue;

    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const moduleDir = path.join(baseDir, entry.name);
        const relDir = path.relative(workDir, moduleDir).replace(/\\/g, "/");
        const pkg = readPackageJson(moduleDir);

        modules.push({
          dir: relDir,
          name: (pkg?.name as string) ?? entry.name,
          description: pkg?.description as string | undefined,
        });
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return modules;
}

function discoverFromDirectoryListing(workDir: string): DiscoveredModule[] {
  const modules: DiscoveredModule[] = [];
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".next",
    ".expo",
  ]);

  try {
    const entries = readdirSync(workDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || skipDirs.has(entry.name)) continue;

      const moduleDir = path.join(workDir, entry.name);
      const pkg = readPackageJson(moduleDir);
      // Only include directories that look like source packages
      if (pkg || existsSync(path.join(moduleDir, "src"))) {
        modules.push({
          dir: entry.name,
          name: (pkg?.name as string) ?? entry.name,
          description: pkg?.description as string | undefined,
        });
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return modules;
}

function renderToc(projectName: string, modules: DiscoveredModule[]): string {
  if (modules.length === 0) {
    return `# Project: ${projectName}\n\nNo modules discovered.`;
  }

  const lines = [`# Project: ${projectName}`, "", "## Modules", ""];
  for (const mod of modules) {
    const desc = mod.description ? ` — ${mod.description}` : "";
    lines.push(`- **${mod.name}** (\`${mod.dir}\`)${desc}`);
  }

  return lines.join("\n");
}
