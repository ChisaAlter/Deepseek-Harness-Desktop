import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type pino from "pino";

import type { CheckoutContext, CheckoutSnapshotFacts } from "../utils/checkout-git.js";
import type { WorkspaceGitRepositoryFetchAuthority } from "./workspace-git-repository-fetch-authority.js";

const WORKSPACE_GIT_FACTS_REUSE_TTL_MS = 1_000;

interface WorkspaceGitCheckoutObservationDependencies {
  watch: typeof watch;
  getCheckoutSnapshotFacts: (
    cwd: string,
    context?: CheckoutContext,
  ) => Promise<CheckoutSnapshotFacts>;
  now: () => Date;
  hasLocalSnapshot?: (cwd: string) => boolean;
}

interface WorkspaceGitCheckoutObservationAuthorityOptions {
  logger: pino.Logger;
  chisacodeHome: string;
  deps: WorkspaceGitCheckoutObservationDependencies;
  repositoryFetchAuthority: WorkspaceGitRepositoryFetchAuthority;
  scheduleRefresh: (cwd: string) => void;
}

interface WorkspaceGitCheckoutObservationTarget {
  cwd: string;
  observed: boolean;
  watchers: FSWatcher[];
  setupPromise: Promise<void> | null;
  setupComplete: boolean;
  repoGitRoot: string | null;
  latestFacts: CheckoutSnapshotFacts | null;
  latestFactsLoadedAtMs: number | null;
  factsPromise: Promise<CheckoutSnapshotFacts> | null;
  factsGeneration: number;
  closed: boolean;
}

/**
 * Owns checkout facts reuse, Git ref watchers, and repository-fetch membership for workspaces.
 */
export class WorkspaceGitCheckoutObservationAuthority {
  private readonly logger: pino.Logger;
  private readonly chisacodeHome: string;
  private readonly deps: WorkspaceGitCheckoutObservationDependencies;
  private readonly repositoryFetchAuthority: WorkspaceGitRepositoryFetchAuthority;
  private readonly scheduleRefresh: (cwd: string) => void;
  private readonly targets = new Map<string, WorkspaceGitCheckoutObservationTarget>();
  private disposed = false;

  constructor(options: WorkspaceGitCheckoutObservationAuthorityOptions) {
    this.logger = options.logger;
    this.chisacodeHome = options.chisacodeHome;
    this.deps = options.deps;
    this.repositoryFetchAuthority = options.repositoryFetchAuthority;
    this.scheduleRefresh = options.scheduleRefresh;
  }

  observe(cwd: string): void {
    if (this.disposed) {
      return;
    }
    const target = this.ensureTarget(cwd);
    target.observed = true;
    this.scheduleSetup(target);
  }

  ensureSetup(cwd: string): void {
    const target = this.targets.get(cwd);
    if (!target?.observed) {
      return;
    }
    this.scheduleSetup(target);
  }

  loadFacts(
    cwd: string,
    context: CheckoutContext,
    options: { allowRecent: boolean },
  ): Promise<CheckoutSnapshotFacts> {
    if (this.disposed) {
      return Promise.reject(new Error("Workspace Git checkout observation authority is disposed"));
    }
    return this.loadFactsForTarget(this.ensureTarget(cwd), context, options);
  }

  remove(cwd: string): void {
    const target = this.targets.get(cwd);
    if (!target) {
      return;
    }
    this.closeTarget(target);
    if (this.targets.get(cwd) === target) {
      this.targets.delete(cwd);
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
  }

  private ensureTarget(cwd: string): WorkspaceGitCheckoutObservationTarget {
    const existingTarget = this.targets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    const target: WorkspaceGitCheckoutObservationTarget = {
      cwd,
      observed: false,
      watchers: [],
      setupPromise: null,
      setupComplete: false,
      repoGitRoot: null,
      latestFacts: null,
      latestFactsLoadedAtMs: null,
      factsPromise: null,
      factsGeneration: 0,
      closed: false,
    };
    this.targets.set(cwd, target);
    return target;
  }

  private scheduleSetup(target: WorkspaceGitCheckoutObservationTarget): void {
    if (target.setupComplete || target.setupPromise || !this.isActiveObservedTarget(target)) {
      return;
    }

    target.setupPromise = Promise.resolve()
      .then(() => this.setupTarget(target))
      .catch((error) => {
        this.logger.warn(
          { err: error, cwd: target.cwd },
          "Failed to set up workspace git observation",
        );
      })
      .finally(() => {
        if (this.isActiveTarget(target)) {
          target.setupPromise = null;
        }
      });
  }

  private async setupTarget(target: WorkspaceGitCheckoutObservationTarget): Promise<void> {
    const facts = await this.loadFactsForTarget(
      target,
      { chisacodeHome: this.chisacodeHome, logger: this.logger },
      { allowRecent: true },
    );
    if (!this.isActiveObservedTarget(target)) {
      return;
    }
    if (!facts.isGit || !facts.absoluteGitDir) {
      target.setupComplete = true;
      return;
    }

    const gitDir = facts.absoluteGitDir;
    const repoGitRoot = facts.gitCommonDir ?? (await this.resolveGitRefsRoot(gitDir));
    if (!this.isActiveObservedTarget(target)) {
      return;
    }

    target.repoGitRoot = repoGitRoot;
    this.startWatchers(target, gitDir, repoGitRoot);

    const hasOrigin = facts.remoteUrl !== null;
    if (!this.isActiveObservedTarget(target)) {
      return;
    }
    if (hasOrigin && this.deps.hasLocalSnapshot?.(target.cwd)) {
      this.repositoryFetchAuthority.attachWorkspace({ repoGitRoot, cwd: target.cwd });
    }
    target.setupComplete = true;
  }

  attachFetchIfReady(cwd: string): void {
    const target = this.targets.get(cwd);
    if (!target?.setupComplete || !target.repoGitRoot || target.closed) {
      return;
    }
    if (!this.deps.hasLocalSnapshot?.(cwd)) {
      return;
    }
    this.repositoryFetchAuthority.attachWorkspace({
      repoGitRoot: target.repoGitRoot,
      cwd: target.cwd,
    });
  }

  private loadFactsForTarget(
    target: WorkspaceGitCheckoutObservationTarget,
    context: CheckoutContext,
    options: { allowRecent: boolean },
  ): Promise<CheckoutSnapshotFacts> {
    if (options.allowRecent && target.latestFacts && target.latestFactsLoadedAtMs !== null) {
      const ageMs = this.deps.now().getTime() - target.latestFactsLoadedAtMs;
      if (ageMs < WORKSPACE_GIT_FACTS_REUSE_TTL_MS) {
        return Promise.resolve(target.latestFacts);
      }
    }

    if (target.factsPromise) {
      return target.factsPromise;
    }

    const generation = target.factsGeneration;
    const promise = this.deps
      .getCheckoutSnapshotFacts(target.cwd, context)
      .then((facts) => {
        if (this.isActiveTarget(target) && target.factsGeneration === generation) {
          target.latestFacts = facts;
          target.latestFactsLoadedAtMs = this.deps.now().getTime();
        }
        return facts;
      })
      .finally(() => {
        if (target.factsPromise === promise) {
          target.factsPromise = null;
        }
      });
    target.factsPromise = promise;
    return promise;
  }

  private async resolveGitRefsRoot(gitDir: string): Promise<string> {
    try {
      const commonDir = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
      if (commonDir.length > 0) {
        return resolve(gitDir, commonDir);
      }
    } catch {
      return gitDir;
    }
    return gitDir;
  }

  private startWatchers(
    target: WorkspaceGitCheckoutObservationTarget,
    gitDir: string,
    repoGitRoot: string,
  ): void {
    for (const watchPath of new Set([join(gitDir, "HEAD"), join(repoGitRoot, "refs", "heads")])) {
      let watcher: FSWatcher | null = null;
      try {
        watcher = this.deps.watch(watchPath, { recursive: false }, () => {
          if (this.isActiveObservedTarget(target)) {
            this.scheduleRefresh(target.cwd);
          }
        });
      } catch (error) {
        this.logger.warn(
          { err: error, cwd: target.cwd, watchPath },
          "Failed to start workspace git watcher",
        );
      }

      if (!watcher) {
        continue;
      }
      watcher.on("error", (error) => {
        this.logger.warn({ err: error, cwd: target.cwd, watchPath }, "Workspace git watcher error");
      });
      target.watchers.push(watcher);
    }
  }

  private isActiveTarget(target: WorkspaceGitCheckoutObservationTarget): boolean {
    return !this.disposed && !target.closed && this.targets.get(target.cwd) === target;
  }

  private isActiveObservedTarget(target: WorkspaceGitCheckoutObservationTarget): boolean {
    return target.observed && this.isActiveTarget(target);
  }

  private closeTarget(target: WorkspaceGitCheckoutObservationTarget): void {
    target.closed = true;
    target.observed = false;
    target.factsGeneration += 1;
    target.factsPromise = null;
    target.latestFacts = null;
    target.latestFactsLoadedAtMs = null;
    if (target.repoGitRoot) {
      this.repositoryFetchAuthority.detachWorkspace(target.repoGitRoot, target.cwd);
      target.repoGitRoot = null;
    }
    for (const watcher of target.watchers) {
      watcher.close();
    }
    target.watchers = [];
    target.setupPromise = null;
    target.setupComplete = false;
  }
}
