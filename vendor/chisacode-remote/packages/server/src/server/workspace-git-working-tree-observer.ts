import type { Dirent, FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import pLimit from "p-limit";
import type pino from "pino";
import { parseGitRevParsePath } from "../utils/git-rev-parse-path.js";
import type { runGitCommand } from "../utils/run-git-command.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-utils.js";
import { normalizeWorkspaceId } from "./workspace-registry-model.js";

const WORKING_TREE_WATCH_FALLBACK_REFRESH_MS = 5_000;
const LINUX_WATCH_MAX_DIRS = 5_000;
const LINUX_WATCH_REFRESH_COOLDOWN_MS = 2_000;
const LINUX_WATCH_IGNORE_TTL_MS = 5 * 60 * 1_000;
const DISPOSED_ERROR_MESSAGE = "Workspace git working tree observer is disposed";

const linuxWatchReaddirConcurrency =
  parseInt(process.env.CHISACODE_LINUX_WATCH_READDIR_CONCURRENCY ?? "16", 10) || 16;
const linuxWatchReaddirLimit = pLimit(linuxWatchReaddirConcurrency);

type WorkingTreeWatchListener = () => void;

interface WorkingTreeWatchTarget {
  cwd: string;
  repoRoot: string | null;
  repoWatchPath: string | null;
  watchers: FSWatcher[];
  watchedPaths: Set<string>;
  fallbackRefreshInterval: NodeJS.Timeout | null;
  linuxTreeRefreshPromise: Promise<void> | null;
  linuxTreeRefreshQueued: boolean;
  listeners: Set<WorkingTreeWatchListener>;
  closed: boolean;
}

interface WorkspaceGitWorkingTreeObserverDependencies {
  watch: typeof import("node:fs").watch;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
  resolveAbsoluteGitDir: (cwd: string) => Promise<string | null>;
  runGitCommand: typeof runGitCommand;
  now: () => Date;
}

export interface WorkspaceGitWorkingTreeObserverOptions {
  logger: pino.Logger;
  deps: WorkspaceGitWorkingTreeObserverDependencies;
  scheduleRefreshForCwd: (cwd: string, options: { force: true; reason: string }) => void;
}

export class WorkspaceGitWorkingTreeObserver {
  private readonly logger: pino.Logger;
  private readonly deps: WorkspaceGitWorkingTreeObserverDependencies;
  private readonly scheduleRefreshForCwd: WorkspaceGitWorkingTreeObserverOptions["scheduleRefreshForCwd"];
  private readonly targets = new Map<string, WorkingTreeWatchTarget>();
  private readonly setups = new Map<string, Promise<WorkingTreeWatchTarget>>();
  private readonly pendingTargets = new Set<WorkingTreeWatchTarget>();
  private readonly linuxIgnoredDirsCache = new Map<string, { ignored: Set<string>; ts: number }>();
  private disposed = false;

  constructor(options: WorkspaceGitWorkingTreeObserverOptions) {
    this.logger = options.logger.child({ component: "working-tree-observer" });
    this.deps = options.deps;
    this.scheduleRefreshForCwd = options.scheduleRefreshForCwd;
  }

  async requestWatch(
    cwd: string,
    onChange: WorkingTreeWatchListener,
  ): Promise<{ repoRoot: string | null; unsubscribe: () => void }> {
    this.assertActive();
    const normalizedCwd = normalizeWorkspaceId(cwd);

    while (true) {
      const target = await this.ensureTarget(normalizedCwd);
      this.assertActive();
      if (target.closed || this.targets.get(normalizedCwd) !== target) {
        continue;
      }
      target.listeners.add(onChange);

      return {
        repoRoot: target.repoRoot,
        unsubscribe: () => {
          this.removeListener(normalizedCwd, onChange);
        },
      };
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const target of this.targets.values()) {
      this.closeTarget(target);
    }
    this.targets.clear();

    for (const target of this.pendingTargets) {
      this.closeTarget(target);
    }
    this.pendingTargets.clear();
    this.setups.clear();
    this.linuxIgnoredDirsCache.clear();
  }

  private async ensureTarget(cwd: string): Promise<WorkingTreeWatchTarget> {
    this.assertActive();
    const existingTarget = this.targets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    const existingSetup = this.setups.get(cwd);
    if (existingSetup) {
      return existingSetup;
    }

    const setup = this.createTarget(cwd)
      .then((target) => {
        try {
          this.assertTargetActive(target);
          this.targets.set(cwd, target);
          return target;
        } catch (error) {
          this.closeTarget(target);
          throw error;
        } finally {
          this.pendingTargets.delete(target);
        }
      })
      .finally(() => {
        if (this.setups.get(cwd) === setup) {
          this.setups.delete(cwd);
        }
      });
    this.setups.set(cwd, setup);
    return setup;
  }

  private async createTarget(cwd: string): Promise<WorkingTreeWatchTarget> {
    const repoRoot = await this.resolveCheckoutWatchRoot(cwd);
    this.assertActive();

    const target: WorkingTreeWatchTarget = {
      cwd,
      repoRoot,
      repoWatchPath: null,
      watchers: [],
      watchedPaths: new Set<string>(),
      fallbackRefreshInterval: null,
      linuxTreeRefreshPromise: null,
      linuxTreeRefreshQueued: false,
      listeners: new Set(),
      closed: false,
    };
    this.pendingTargets.add(target);

    try {
      const repoWatchPath = repoRoot ?? cwd;
      target.repoWatchPath = repoWatchPath;
      const watchPaths = new Set<string>([repoWatchPath]);
      const gitDir = await this.deps.resolveAbsoluteGitDir(cwd);
      this.assertTargetActive(target);
      if (gitDir) {
        watchPaths.add(gitDir);
      }

      let hasRecursiveRepoCoverage = false;
      const allowRecursiveRepoWatch = process.platform !== "linux";
      if (process.platform === "linux") {
        hasRecursiveRepoCoverage = await this.ensureLinuxRepoTreeWatchers(target, repoWatchPath);
        this.assertTargetActive(target);
      }
      for (const watchPath of watchPaths) {
        if (process.platform === "linux" && watchPath === repoWatchPath) {
          continue;
        }
        const shouldTryRecursive = watchPath === repoWatchPath && allowRecursiveRepoWatch;
        const watcherIsRecursive = this.addWatcher(target, watchPath, shouldTryRecursive);
        if (watchPath === repoWatchPath && watcherIsRecursive) {
          hasRecursiveRepoCoverage = true;
        }
      }

      const missingRepoCoverage = repoRoot === null || !hasRecursiveRepoCoverage;
      if (target.watchers.length === 0 || missingRepoCoverage) {
        this.startFallbackRefresh(target);
      }

      return target;
    } catch (error) {
      this.closeTarget(target);
      this.pendingTargets.delete(target);
      throw error;
    }
  }

  private async resolveCheckoutWatchRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.deps.runGitCommand(["rev-parse", "--show-toplevel"], {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      return parseGitRevParsePath(stdout);
    } catch {
      return null;
    }
  }

  private startFallbackRefresh(target: WorkingTreeWatchTarget): void {
    if (target.closed || target.fallbackRefreshInterval) {
      return;
    }

    target.fallbackRefreshInterval = setInterval(() => {
      if (target.closed || this.disposed) {
        return;
      }
      this.scheduleRefreshForCwd(target.cwd, {
        force: true,
        reason: "working-tree-watch-fallback",
      });
      this.notifyListeners(target);
    }, WORKING_TREE_WATCH_FALLBACK_REFRESH_MS);
    this.logger.warn(
      {
        cwd: target.cwd,
        intervalMs: WORKING_TREE_WATCH_FALLBACK_REFRESH_MS,
        reason:
          target.watchers.length === 0 ? "no_watchers" : "missing_recursive_repo_root_coverage",
      },
      "Working tree watchers unavailable; using timed refresh fallback",
    );
  }

  private addWatcher(
    target: WorkingTreeWatchTarget,
    watchPath: string,
    shouldTryRecursive: boolean,
  ): boolean {
    if (target.closed || this.disposed || target.watchedPaths.has(watchPath)) {
      return false;
    }

    const { cwd } = target;
    const onChange = () => {
      if (target.closed || this.disposed) {
        return;
      }
      if (process.platform === "linux" && target.repoWatchPath) {
        void this.refreshLinuxRepoTreeWatchers(target);
      }
      this.scheduleRefreshForCwd(cwd, {
        force: true,
        reason: "working-tree-watch",
      });
      this.notifyListeners(target);
    };
    const createWatcher = (recursive: boolean): FSWatcher =>
      this.deps.watch(watchPath, { recursive }, onChange);

    let watcher: FSWatcher | null = null;
    let watcherIsRecursive = false;
    try {
      if (shouldTryRecursive) {
        watcher = createWatcher(true);
        watcherIsRecursive = true;
      } else {
        watcher = createWatcher(false);
      }
    } catch (error) {
      if (shouldTryRecursive) {
        try {
          watcher = createWatcher(false);
          this.logger.warn(
            { err: error, watchPath, cwd },
            "Working tree recursive watch unavailable; using non-recursive fallback",
          );
        } catch (fallbackError) {
          this.logger.warn(
            { err: fallbackError, watchPath, cwd },
            "Failed to start working tree watcher",
          );
        }
      } else {
        this.logger.warn({ err: error, watchPath, cwd }, "Failed to start working tree watcher");
      }
    }

    if (!watcher) {
      return false;
    }
    if (target.closed || this.disposed) {
      watcher.close();
      return false;
    }

    watcher.on("error", (error) => {
      this.logger.warn({ err: error, watchPath, cwd }, "Working tree watcher error");
    });
    target.watchers.push(watcher);
    target.watchedPaths.add(watchPath);
    return watcherIsRecursive;
  }

  private async ensureLinuxRepoTreeWatchers(
    target: WorkingTreeWatchTarget,
    rootPath: string,
  ): Promise<boolean> {
    const directories = await this.listLinuxWatchDirectories(rootPath);
    if (target.closed || this.disposed) {
      return false;
    }

    let complete = true;
    for (const directory of directories) {
      if (target.closed || this.disposed) {
        return false;
      }
      const watcherWasRecursive = this.addWatcher(target, directory, false);
      if (!watcherWasRecursive && !target.watchedPaths.has(directory)) {
        complete = false;
      }
    }
    return complete && target.watchedPaths.has(rootPath);
  }

  private async refreshLinuxRepoTreeWatchers(target: WorkingTreeWatchTarget): Promise<void> {
    if (process.platform !== "linux" || !target.repoWatchPath || target.closed || this.disposed) {
      return;
    }
    const rootPath = target.repoWatchPath;
    if (target.linuxTreeRefreshPromise) {
      target.linuxTreeRefreshQueued = true;
      return;
    }

    const refreshPromise = (async () => {
      do {
        target.linuxTreeRefreshQueued = false;
        try {
          await this.ensureLinuxRepoTreeWatchers(target, rootPath);
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              cwd: target.cwd,
              rootPath,
            },
            "Failed to refresh Linux working tree watchers",
          );
        }
        if (target.linuxTreeRefreshQueued && !target.closed && !this.disposed) {
          await new Promise((resolveCooldown) =>
            setTimeout(resolveCooldown, LINUX_WATCH_REFRESH_COOLDOWN_MS),
          );
        }
      } while (target.linuxTreeRefreshQueued && !target.closed && !this.disposed);
    })();
    target.linuxTreeRefreshPromise = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (target.linuxTreeRefreshPromise === refreshPromise) {
        target.linuxTreeRefreshPromise = null;
      }
    }
  }

  private async listLinuxWatchDirectories(rootPath: string): Promise<string[]> {
    const ignored = await this.loadLinuxIgnoredDirs(rootPath);
    const directories: string[] = [];
    let currentLevel: string[] = [rootPath];
    let capped = false;

    while (currentLevel.length > 0) {
      directories.push(...currentLevel);
      if (directories.length >= LINUX_WATCH_MAX_DIRS) {
        capped = true;
        break;
      }
      const readResults = await Promise.all(
        currentLevel.map((directory) =>
          linuxWatchReaddirLimit(async () => {
            try {
              return await this.deps.readdir(directory, { withFileTypes: true });
            } catch {
              return null;
            }
          }),
        ),
      );
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 1) {
        const directory = currentLevel[i];
        const entries = readResults[i];
        if (!directory || !entries) {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === ".git") {
            continue;
          }
          const childPath = join(directory, entry.name);
          if (ignored.has(childPath)) {
            continue;
          }
          nextLevel.push(childPath);
        }
      }
      currentLevel = nextLevel;
    }

    if (capped) {
      this.logger.warn(
        { rootPath, limit: LINUX_WATCH_MAX_DIRS, walked: directories.length },
        "Linux working tree exceeds watcher cap; skipping deeper directories",
      );
    }

    return directories;
  }

  private async loadLinuxIgnoredDirs(rootPath: string): Promise<Set<string>> {
    const cached = this.linuxIgnoredDirsCache.get(rootPath);
    const nowMs = this.deps.now().getTime();
    if (cached && nowMs - cached.ts < LINUX_WATCH_IGNORE_TTL_MS) {
      return cached.ignored;
    }

    const ignored = new Set<string>();
    try {
      const result = await this.deps.runGitCommand(
        ["ls-files", "-o", "-i", "--directory", "--exclude-standard"],
        { cwd: rootPath, envOverlay: READ_ONLY_GIT_ENV },
      );
      for (const raw of result.stdout.split("\n")) {
        if (!raw.endsWith("/")) {
          continue;
        }
        const rel = raw.replace(/\/+$/, "");
        if (!rel) {
          continue;
        }
        ignored.add(resolve(rootPath, rel));
      }
    } catch (error) {
      this.logger.debug(
        { err: error, rootPath },
        "Failed to load gitignore directories; falling back to name-based skip only",
      );
    }

    this.linuxIgnoredDirsCache.set(rootPath, { ignored, ts: nowMs });
    return ignored;
  }

  private notifyListeners(target: WorkingTreeWatchTarget): void {
    for (const listener of Array.from(target.listeners)) {
      try {
        listener();
      } catch (error) {
        this.logger.warn({ err: error, cwd: target.cwd }, "Working tree watch listener threw");
      }
    }
  }

  private removeListener(cwd: string, listener: WorkingTreeWatchListener): void {
    const target = this.targets.get(cwd);
    if (!target) {
      return;
    }

    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }

    this.closeTarget(target);
    this.targets.delete(cwd);
  }

  private closeTarget(target: WorkingTreeWatchTarget): void {
    if (target.closed) {
      return;
    }
    target.closed = true;
    target.linuxTreeRefreshQueued = false;
    if (target.fallbackRefreshInterval) {
      clearInterval(target.fallbackRefreshInterval);
      target.fallbackRefreshInterval = null;
    }

    for (const watcher of target.watchers) {
      watcher.close();
    }
    target.watchers = [];
    target.watchedPaths.clear();
    target.listeners.clear();
    if (target.repoWatchPath) {
      this.linuxIgnoredDirsCache.delete(target.repoWatchPath);
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error(DISPOSED_ERROR_MESSAGE);
    }
  }

  private assertTargetActive(target: WorkingTreeWatchTarget): void {
    if (this.disposed || target.closed) {
      throw new Error(DISPOSED_ERROR_MESSAGE);
    }
  }
}
