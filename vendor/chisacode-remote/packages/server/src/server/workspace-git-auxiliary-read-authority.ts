import { LRUCache } from "lru-cache";

import type {
  BranchCheckoutResolution,
  BranchSuggestion,
  CheckoutDiffCompare,
  CheckoutDiffResult,
  getCheckoutDiff,
  listBranchSuggestions,
  resolveBranchCheckout,
  resolveRepositoryDefaultBranch,
} from "../utils/checkout-git.js";
import type { runGitCommand } from "../utils/run-git-command.js";
import type { ChisaCodeWorktreeInfo, listChisaCodeWorktrees } from "../utils/worktree.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-utils.js";
import {
  buildWorkspaceGitMetadataFromSnapshot,
  type WorkspaceGitMetadata,
} from "./workspace-git-metadata.js";
import { normalizeWorkspaceId } from "./workspace-registry-model.js";

const WORKSPACE_GIT_AUXILIARY_READ_TTL_MS = 15_000;
const WORKSPACE_GIT_INTERNAL_MIN_GAP_MS = 2_000;
const WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX = 64;
const WORKSPACE_GIT_AUXILIARY_CACHE_MAX = 256;
const CHISACODE_STASH_PREFIX = "chisacode-auto-stash:";

/** Read options for cached workspace Git queries. */
export type WorkspaceGitReadOptions =
  | {
      force?: false;
      reason?: string;
    }
  | {
      force: true;
      reason: string;
    };

/** Filters for workspace branch suggestions. */
export interface WorkspaceGitBranchSuggestionsOptions {
  query?: string;
  limit?: number;
}

/** Filters for workspace stash reads. */
export interface WorkspaceGitStashListOptions {
  chisacodeOnly?: boolean;
}

/** Parsed stash metadata exposed by the workspace Git service. */
export interface WorkspaceGitStashEntry {
  index: number;
  message: string;
  branch: string | null;
  isChisaCode: boolean;
}

/** Result of resolving a checkout branch reference. */
export type WorkspaceGitBranchValidationResult = BranchCheckoutResolution;

/** Branch suggestion returned by cached workspace Git reads. */
export type WorkspaceGitBranchSuggestion = BranchSuggestion;

/** ChisaCode-managed worktree metadata. */
export type WorkspaceGitWorktreeInfo = ChisaCodeWorktreeInfo;

interface WorkspaceGitAuxiliarySnapshot {
  git: {
    isGit: boolean;
    repoRoot: string | null;
    mainRepoRoot: string | null;
    currentBranch: string | null;
    remoteUrl: string | null;
    isChisaCodeOwnedWorktree: boolean;
  };
}

interface WorkspaceGitAuxiliaryReadDependencies {
  getCheckoutDiff: typeof getCheckoutDiff;
  resolveBranchCheckout: typeof resolveBranchCheckout;
  resolveRepositoryDefaultBranch: typeof resolveRepositoryDefaultBranch;
  listBranchSuggestions: typeof listBranchSuggestions;
  listChisaCodeWorktrees: typeof listChisaCodeWorktrees;
  runGitCommand: typeof runGitCommand;
  getSnapshot: (
    cwd: string,
    options?: WorkspaceGitReadOptions,
  ) => Promise<WorkspaceGitAuxiliarySnapshot>;
  now: () => Date;
}

interface WorkspaceGitAuxiliaryReadAuthorityOptions {
  chisacodeHome: string;
  deps: WorkspaceGitAuxiliaryReadDependencies;
}

interface WorkspaceGitAuxiliaryReadCacheEntry<T> {
  value: T | null;
  loadedAtMs: number | null;
  lastShellOutAtMs: number | null;
  inFlight: Promise<T> | null;
}

/**
 * Owns cached auxiliary Git reads that are independent from workspace snapshot refresh state.
 */
export class WorkspaceGitAuxiliaryReadAuthority {
  private readonly chisacodeHome: string;
  private readonly deps: WorkspaceGitAuxiliaryReadDependencies;
  private readonly branchValidationCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchValidationResult>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly localBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<boolean>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly branchSuggestionsCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchSuggestion[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly stashListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitStashEntry[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly worktreeListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitWorktreeInfo[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly defaultBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<string>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly checkoutDiffCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<CheckoutDiffResult>
  >({ max: WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX });

  constructor(options: WorkspaceGitAuxiliaryReadAuthorityOptions) {
    this.chisacodeHome = options.chisacodeHome;
    this.deps = options.deps;
  }

  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    const normalizedOptions = this.normalizeCheckoutDiffOptions(options);
    const key = this.buildCheckoutDiffCacheKey(normalizedCwd, normalizedOptions);
    return this.readCache(this.checkoutDiffCache, key, readOptions, () =>
      this.deps.getCheckoutDiff(normalizedCwd, normalizedOptions, {
        chisacodeHome: this.chisacodeHome,
      }),
    );
  }

  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    const normalizedRef = ref.trim();
    const key = JSON.stringify(["branch-validation", normalizedCwd, normalizedRef]);
    return this.readCache(this.branchValidationCache, key, options, () =>
      this.deps.resolveBranchCheckout(normalizedCwd, normalizedRef),
    );
  }

  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    const normalizedBranch = branch.trim();
    const ref = `refs/heads/${normalizedBranch}`;
    const key = JSON.stringify(["local-branch", normalizedCwd, ref]);
    return this.readCache(this.localBranchCache, key, options, async () => {
      const result = await this.deps.runGitCommand(["rev-parse", "--verify", "--quiet", ref], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
        acceptExitCodes: [0, 1],
      });
      return result.exitCode === 0;
    });
  }

  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    const query = options?.query ?? "";
    const limit = options?.limit;
    const key = JSON.stringify(["branch-suggestions", normalizedCwd, query, limit ?? null]);
    return this.readCache(this.branchSuggestionsCache, key, readOptions, () =>
      this.deps.listBranchSuggestions(normalizedCwd, options),
    );
  }

  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    const chisacodeOnly = options?.chisacodeOnly !== false;
    const key = JSON.stringify(["stashes", normalizedCwd, chisacodeOnly]);
    return this.readCache(this.stashListCache, key, readOptions, async () => {
      const { stdout } = await this.deps.runGitCommand(["stash", "list", "--format=%gd%x00%s"], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      return parseWorkspaceGitStashList(stdout, { chisacodeOnly });
    });
  }

  async listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]> {
    const repoRoot = await this.resolveRepoRoot(cwdOrRepoRoot, options);
    const key = JSON.stringify(["worktrees", repoRoot]);
    return this.readCache(this.worktreeListCache, key, options, () =>
      this.deps.listChisaCodeWorktrees({
        cwd: repoRoot,
        chisacodeHome: this.chisacodeHome,
      }),
    );
  }

  async resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string> {
    const snapshot = await this.deps.getSnapshot(cwd, options);
    if (!snapshot.git.isGit) {
      throw new Error("Create worktree requires a git repository");
    }

    return snapshot.git.isChisaCodeOwnedWorktree
      ? (snapshot.git.mainRepoRoot ?? snapshot.git.repoRoot ?? normalizeWorkspaceId(cwd))
      : (snapshot.git.repoRoot ?? normalizeWorkspaceId(cwd));
  }

  resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string> {
    const cwd = normalizeWorkspaceId(cwdOrRepoRoot);
    const key = JSON.stringify(["default-branch", cwd]);
    return this.readCache(this.defaultBranchCache, key, options, async () => {
      const defaultBranch = await this.deps.resolveRepositoryDefaultBranch(cwd);
      if (!defaultBranch) {
        throw new Error("Unable to resolve repository default branch");
      }
      return defaultBranch;
    });
  }

  async getWorkspaceGitMetadata(
    cwd: string,
    options?: WorkspaceGitReadOptions & { directoryName?: string },
  ): Promise<WorkspaceGitMetadata> {
    const snapshot = await this.deps.getSnapshot(cwd, options);
    const directoryName =
      options?.directoryName ?? normalizeWorkspaceId(cwd).split(/[\\/]/).findLast(Boolean) ?? cwd;
    return buildWorkspaceGitMetadataFromSnapshot({
      cwd: normalizeWorkspaceId(cwd),
      directoryName,
      isGit: snapshot.git.isGit,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
    });
  }

  async resolveRepoRemoteUrl(
    cwd: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<string | null> {
    const snapshot = await this.deps.getSnapshot(cwd, options);
    return snapshot.git.remoteUrl;
  }

  private normalizeCheckoutDiffOptions(options: CheckoutDiffCompare): CheckoutDiffCompare {
    return {
      mode: options.mode,
      ...(options.mode === "base" && options.baseRef !== undefined
        ? { baseRef: options.baseRef }
        : {}),
      ...(options.ignoreWhitespace === true ? { ignoreWhitespace: true } : {}),
      ...(options.includeStructured === true ? { includeStructured: true } : {}),
    };
  }

  private buildCheckoutDiffCacheKey(cwd: string, options: CheckoutDiffCompare): string {
    return JSON.stringify([
      "checkout-diff",
      cwd,
      options.mode,
      options.mode === "base" ? (options.baseRef ?? null) : null,
      options.ignoreWhitespace === true,
      options.includeStructured === true,
    ]);
  }

  private readCache<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
    options: WorkspaceGitReadOptions | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService forced read requires a reason");
    }

    const entry = this.ensureCacheEntry(cache, key);
    const nowMs = this.deps.now().getTime();
    if (!options?.force && entry.value !== null && entry.loadedAtMs !== null) {
      const ageMs = nowMs - entry.loadedAtMs;
      if (ageMs <= WORKSPACE_GIT_AUXILIARY_READ_TTL_MS) {
        return Promise.resolve(entry.value);
      }
      if (
        entry.lastShellOutAtMs !== null &&
        nowMs - entry.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS
      ) {
        return Promise.resolve(entry.value);
      }
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    entry.lastShellOutAtMs = nowMs;
    entry.inFlight = load()
      .then((value) => {
        entry.value = value;
        entry.loadedAtMs = this.deps.now().getTime();
        return value;
      })
      .finally(() => {
        entry.inFlight = null;
      });
    return entry.inFlight;
  }

  private ensureCacheEntry<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
  ): WorkspaceGitAuxiliaryReadCacheEntry<T> {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }

    const entry: WorkspaceGitAuxiliaryReadCacheEntry<T> = {
      value: null,
      loadedAtMs: null,
      lastShellOutAtMs: null,
      inFlight: null,
    };
    cache.set(key, entry);
    return entry;
  }
}

function parseWorkspaceGitStashList(
  stdout: string,
  options: { chisacodeOnly: boolean },
): WorkspaceGitStashEntry[] {
  const entries: WorkspaceGitStashEntry[] = [];
  const lines = stdout.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    const sepIdx = line.indexOf("\0");
    if (sepIdx < 0) {
      continue;
    }

    const refPart = line.slice(0, sepIdx);
    const subject = line.slice(sepIdx + 1);
    const indexMatch = refPart.match(/\{(\d+)\}/);
    if (!indexMatch) {
      continue;
    }

    const index = Number(indexMatch[1]);
    const prefixIdx = subject.indexOf(CHISACODE_STASH_PREFIX);
    const isChisaCode = prefixIdx >= 0;
    const branch = isChisaCode
      ? subject.slice(prefixIdx + CHISACODE_STASH_PREFIX.length).trim() || null
      : null;

    if (options.chisacodeOnly && !isChisaCode) {
      continue;
    }

    entries.push({ index, message: subject, branch, isChisaCode });
  }

  return entries;
}
