import { readFile, stat as statFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TTLCache } from "@isaacs/ttlcache";

import { PER_FILE_DIFF_MAX_BYTES, isLikelyBinaryFile } from "./checkout-git-file-inspection.js";
import { READ_ONLY_GIT_ENV, requireGitRepo } from "./checkout-git-repository.js";
import { runGitCommand } from "./run-git-command.js";

const DEFAULT_SHORTSTAT_CACHE_TTL_MS = 15_000;
const SHORTSTAT_CACHE_MAX = 1_000;

let shortstatCacheTtlMs = DEFAULT_SHORTSTAT_CACHE_TTL_MS;
let shortstatCache = createShortstatCache(shortstatCacheTtlMs);
const shortstatInFlight = new Map<string, Promise<CheckoutShortstat | null>>();

interface CheckoutShortstatReadOptions {
  force?: boolean;
}

type CheckoutShortstatFacts =
  | { isGit: false }
  | {
      isGit: true;
      resolvedBaseRef: string | null;
      currentBranch: string | null;
      comparisonBaseRef: string | null;
    };

interface CheckoutShortstatDependencies<TContext> {
  getFacts(context: TContext | undefined): CheckoutShortstatFacts | null | undefined;
  getResolvedBaseRefForCwd(cwd: string, context: TContext | undefined): Promise<string | null>;
  getCurrentBranch(cwd: string): Promise<string | null>;
  resolveBestComparisonBaseRef(cwd: string, baseRef: string): Promise<string>;
  doesGitRefExist(cwd: string, fullRef: string): Promise<boolean>;
}

function createShortstatCache(ttlMs: number) {
  return new TTLCache<string, CheckoutShortstat | null>({
    ttl: ttlMs,
    max: SHORTSTAT_CACHE_MAX,
    checkAgeOnGet: true,
  });
}

function getShortstatCacheKey(cwd: string): string {
  return resolve(cwd);
}

function resetCheckoutShortstatCache(): void {
  shortstatCache.clear();
  shortstatCache.cancelTimer();
  shortstatCacheTtlMs = DEFAULT_SHORTSTAT_CACHE_TTL_MS;
  shortstatCache = createShortstatCache(shortstatCacheTtlMs);
  shortstatInFlight.clear();
}

function setCheckoutShortstatCacheTtl(ttlMs: number): void {
  shortstatCache.clear();
  shortstatCache.cancelTimer();
  shortstatCacheTtlMs = ttlMs;
  shortstatCache = createShortstatCache(ttlMs);
  shortstatInFlight.clear();
}
/** Aggregate line additions and deletions relative to a checkout comparison ref. */
export interface CheckoutShortstat {
  additions: number;
  deletions: number;
}

function parseCheckoutShortstat(text: string): CheckoutShortstat | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  let additions = 0;
  let deletions = 0;
  const addMatch = trimmed.match(/(\d+)\s+insertion/);
  if (addMatch) {
    additions = Number.parseInt(addMatch[1], 10);
  }
  const delMatch = trimmed.match(/(\d+)\s+deletion/);
  if (delMatch) {
    deletions = Number.parseInt(delMatch[1], 10);
  }

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return { additions, deletions };
}

const UNTRACKED_SHORTSTAT_MAX_FILES = 500;

async function countUntrackedAdditions(cwd: string): Promise<number> {
  try {
    const { stdout } = await runGitCommand(["ls-files", "--others", "--exclude-standard"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const files = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let additions = 0;
    for (const file of files.slice(0, UNTRACKED_SHORTSTAT_MAX_FILES)) {
      const absolutePath = resolve(cwd, file);
      try {
        const metadata = await statFile(absolutePath);
        if (metadata.size > PER_FILE_DIFF_MAX_BYTES) continue;
        if (await isLikelyBinaryFile(absolutePath)) continue;
        const content = await readFile(absolutePath, "utf-8");
        if (content.length === 0) continue;
        const normalized = content.replace(/\r\n/g, "\n");
        const lineCount = normalized.split("\n").length;
        additions += normalized.endsWith("\n") ? lineCount - 1 : lineCount;
      } catch {
        // Skip unreadable files.
      }
    }
    return additions;
  } catch {
    return 0;
  }
}

async function getCheckoutShortstatUncached<TContext>(
  cwd: string,
  context: TContext | undefined,
  dependencies: CheckoutShortstatDependencies<TContext>,
): Promise<CheckoutShortstat | null> {
  const facts = dependencies.getFacts(context);
  if (facts?.isGit === false) {
    return null;
  }
  if (!facts?.isGit) {
    try {
      await requireGitRepo(cwd);
    } catch {
      return null;
    }
  }

  const localBaseRef = facts?.isGit
    ? facts.resolvedBaseRef
    : await dependencies.getResolvedBaseRefForCwd(cwd, context);
  const currentBranch = facts?.isGit
    ? facts.currentBranch
    : await dependencies.getCurrentBranch(cwd);
  const comparisonRef = await resolveShortstatComparisonRef(
    {
      cwd,
      currentBranch,
      localBaseRef,
      facts,
    },
    dependencies,
  );
  if (!comparisonRef) {
    return null;
  }

  try {
    const { stdout: mergeBaseOut } = await runGitCommand(["merge-base", "HEAD", comparisonRef], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const mergeBase = mergeBaseOut.trim();
    if (!mergeBase) {
      return null;
    }

    const [{ stdout }, untrackedAdditions] = await Promise.all([
      runGitCommand(["diff", "--shortstat", mergeBase], {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      }),
      countUntrackedAdditions(cwd),
    ]);

    const tracked = parseCheckoutShortstat(stdout);

    if (tracked) {
      return { additions: tracked.additions + untrackedAdditions, deletions: tracked.deletions };
    }
    if (untrackedAdditions > 0) {
      return { additions: untrackedAdditions, deletions: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveShortstatComparisonRef<TContext>(
  input: {
    cwd: string;
    currentBranch: string | null;
    localBaseRef: string | null;
    facts?: CheckoutShortstatFacts | null;
  },
  dependencies: CheckoutShortstatDependencies<TContext>,
): Promise<string | null> {
  const { cwd, currentBranch, localBaseRef, facts } = input;
  if (!currentBranch) {
    return null;
  }

  if (localBaseRef && currentBranch !== localBaseRef) {
    try {
      return facts?.isGit && facts.resolvedBaseRef === localBaseRef && facts.comparisonBaseRef
        ? facts.comparisonBaseRef
        : await dependencies.resolveBestComparisonBaseRef(cwd, localBaseRef);
    } catch {
      return null;
    }
  }

  const hasOrigin = await dependencies.doesGitRefExist(cwd, `refs/remotes/origin/${currentBranch}`);
  return hasOrigin ? `origin/${currentBranch}` : null;
}

function getOrLoadCheckoutShortstat<TContext>(
  cwd: string,
  context: TContext | undefined,
  options: CheckoutShortstatReadOptions | undefined,
  dependencies: CheckoutShortstatDependencies<TContext>,
): Promise<CheckoutShortstat | null> {
  const cacheKey = getShortstatCacheKey(cwd);
  if (!options?.force) {
    const cached = shortstatCache.get(cacheKey);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existing = shortstatInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }

  const load = getCheckoutShortstatUncached(cwd, context, dependencies)
    .then((shortstat) => {
      shortstatCache.set(cacheKey, shortstat);
      return shortstat;
    })
    .finally(() => {
      shortstatInFlight.delete(cacheKey);
    });

  shortstatInFlight.set(cacheKey, load);
  return load;
}

/** Checkout shortstat cache and read operations bound to checkout fact resolvers. */
export interface CheckoutShortstatAuthority<TContext> {
  get(
    cwd: string,
    context?: TContext,
    options?: CheckoutShortstatReadOptions,
  ): Promise<CheckoutShortstat | null>;
  getCached(cwd: string): CheckoutShortstat | null | undefined;
  warm(cwd: string, context?: TContext, onComplete?: () => void): void;
  resetCacheForTests(): void;
  setCacheTtlForTests(ttlMs: number): void;
}

/**
 * Creates the cached checkout shortstat authority.
 * @param dependencies Checkout fact and ref resolvers
 * @returns Bound shortstat cache and read operations
 */
export function createCheckoutShortstatAuthority<TContext>(
  dependencies: CheckoutShortstatDependencies<TContext>,
): CheckoutShortstatAuthority<TContext> {
  return {
    get: (cwd, context, options) => getOrLoadCheckoutShortstat(cwd, context, options, dependencies),
    getCached: (cwd) => shortstatCache.get(getShortstatCacheKey(cwd)),
    warm(cwd, context, onComplete) {
      const cacheKey = getShortstatCacheKey(cwd);
      if (shortstatCache.get(cacheKey) !== undefined || shortstatInFlight.has(cacheKey)) {
        return;
      }

      void getOrLoadCheckoutShortstat(cwd, context, undefined, dependencies)
        .then(() => {
          onComplete?.();
          return;
        })
        .catch(() => {
          // Non-critical: keep listing path resilient even if git commands fail.
        });
    },
    resetCacheForTests: resetCheckoutShortstatCache,
    setCacheTtlForTests: setCheckoutShortstatCacheTtl,
  };
}
