import { READ_ONLY_GIT_ENV, requireGitRepo } from "./checkout-git-repository.js";
import { runGitCommand } from "./run-git-command.js";

function throwBranchNotFound(branch: string | undefined): never {
  throw new Error(`Branch not found: ${branch ?? "unknown"}`);
}

function normalizeBranchSuggestionName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = trimmed;
  if (normalized.startsWith("refs/heads/")) {
    normalized = normalized.slice("refs/heads/".length);
  } else if (normalized.startsWith("refs/remotes/")) {
    normalized = normalized.slice("refs/remotes/".length);
  }

  if (normalized.startsWith("origin/")) {
    normalized = normalized.slice("origin/".length);
  }

  if (!normalized || normalized === "HEAD" || normalized === "origin") {
    return null;
  }

  return normalized;
}

interface GitRef {
  name: string;
  committerDate: number;
}

/** Branch item shown by checkout branch discovery. */
export interface BranchSuggestion {
  name: string;
  committerDate: number;
  hasLocal: boolean;
  hasRemote: boolean;
}

async function listGitRefs(cwd: string): Promise<GitRef[]> {
  const { stdout } = await runGitCommand(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(committerdate:unix)",
      "refs/heads",
      "refs/remotes/origin",
    ],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  return stdout
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const [name, dateStr] = trimmed.split("\t");
      if (!name) return null;
      return { name, committerDate: Number(dateStr) || 0 };
    })
    .filter((ref): ref is GitRef => ref !== null);
}

interface BranchSuggestionMeta {
  committerDate: number;
  hasLocal: boolean;
  hasRemote: boolean;
}

function sortBranchSuggestions(
  branchNames: string[],
  branchMeta: Map<string, BranchSuggestionMeta>,
  query: string,
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;
  return branchNames.sort((a, b) => {
    if (hasQuery) {
      const aPrefix = a.toLowerCase().startsWith(normalizedQuery);
      const bPrefix = b.toLowerCase().startsWith(normalizedQuery);
      if (aPrefix !== bPrefix) {
        return aPrefix ? -1 : 1;
      }
    }

    const aMeta = branchMeta.get(a);
    const bMeta = branchMeta.get(b);
    const aDate = aMeta?.committerDate ?? 0;
    const bDate = bMeta?.committerDate ?? 0;
    if (aDate !== bDate) {
      return bDate - aDate;
    }

    return a.localeCompare(b);
  });
}

/**
 * Lists local and origin branch suggestions from one ref snapshot.
 * @param cwd Repository working directory
 * @param options Optional query and result limit
 * @returns Branch suggestions sorted by query relevance and commit recency
 */
export async function listBranchSuggestions(
  cwd: string,
  options?: { query?: string; limit?: number },
): Promise<BranchSuggestion[]> {
  await requireGitRepo(cwd);

  const requestedLimit = options?.limit ?? 50;
  const limit = Math.max(1, Math.min(200, requestedLimit));
  const query = options?.query?.trim().toLowerCase() ?? "";
  const refs = await listGitRefs(cwd);
  const branchMeta = new Map<string, BranchSuggestionMeta>();

  for (const ref of refs) {
    const hasLocal = ref.name.startsWith("refs/heads/");
    const hasRemote = ref.name.startsWith("refs/remotes/origin/");
    if (!hasLocal && !hasRemote) {
      continue;
    }

    const normalized = normalizeBranchSuggestionName(ref.name);
    if (!normalized) continue;
    const existing = branchMeta.get(normalized);
    branchMeta.set(normalized, {
      hasLocal: hasLocal || existing?.hasLocal === true,
      hasRemote: hasRemote || existing?.hasRemote === true,
      committerDate: Math.max(ref.committerDate, existing?.committerDate ?? 0),
    });
  }

  const filteredNames = Array.from(branchMeta.keys()).filter((name) =>
    query ? name.toLowerCase().includes(query) : true,
  );
  if (filteredNames.length === 0) {
    return [];
  }

  const ordered = sortBranchSuggestions(filteredNames, branchMeta, query);
  return ordered.slice(0, limit).map((name) => {
    const meta = branchMeta.get(name);
    return {
      name,
      committerDate: meta?.committerDate ?? 0,
      hasLocal: meta?.hasLocal ?? false,
      hasRemote: meta?.hasRemote ?? false,
    };
  });
}

/** A checkout target already available as a local branch. */
export interface LocalBranchCheckoutResolution {
  kind: "local";
  name: string;
}

/** A checkout target that must create a local branch tracking origin. */
export interface RemoteOnlyBranchCheckoutResolution {
  kind: "remote-only";
  name: string;
  remoteRef: string;
}

/** A branch lookup result with no local or origin match. */
export interface NotFoundBranchCheckoutResolution {
  kind: "not-found";
}

/** Resolution returned before mutating a checkout. */
export type BranchCheckoutResolution =
  | LocalBranchCheckoutResolution
  | RemoteOnlyBranchCheckoutResolution
  | NotFoundBranchCheckoutResolution;

/**
 * Resolves a branch name to a local or origin-tracking checkout target.
 * @param cwd Repository working directory
 * @param name User-facing branch name or origin-prefixed branch name
 * @returns The non-mutating branch checkout resolution
 */
export async function resolveBranchCheckout(
  cwd: string,
  name: string,
): Promise<BranchCheckoutResolution> {
  await requireGitRepo(cwd);

  const normalized = normalizeBranchSuggestionName(name);
  if (!normalized) {
    return { kind: "not-found" };
  }

  const localRef = `refs/heads/${normalized}`;
  const localResult = await runGitCommand(["rev-parse", "--verify", "--quiet", localRef], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  if (localResult.exitCode === 0) {
    return { kind: "local", name: normalized };
  }

  const remoteRef = `origin/${normalized}`;
  const remoteRefPath = `refs/remotes/${remoteRef}`;
  const remoteResult = await runGitCommand(["rev-parse", "--verify", "--quiet", remoteRefPath], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  if (remoteResult.exitCode === 0) {
    return { kind: "remote-only", name: normalized, remoteRef };
  }

  return { kind: "not-found" };
}

/** Source used to check out an existing branch. */
export type BranchCheckoutSource = "local" | "remote";

/** Result of checking out an existing branch. */
export interface CheckoutExistingBranchResult {
  source: BranchCheckoutSource;
}

/** Input for applying a previously validated branch resolution. */
export interface CheckoutResolvedBranchInput {
  cwd: string;
  resolution: BranchCheckoutResolution;
  requestedBranch?: string;
}

/**
 * Checks out a previously resolved local or origin branch target.
 * @param input Repository and branch resolution to apply
 * @returns The local or remote source used for the checkout
 * @throws {Error} If the resolved branch no longer exists or checkout fails
 */
export async function checkoutResolvedBranch(
  input: CheckoutResolvedBranchInput,
): Promise<CheckoutExistingBranchResult> {
  const { cwd, resolution } = input;

  switch (resolution.kind) {
    case "local": {
      const { stdout } = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      const current = stdout.trim();
      if (current === resolution.name) {
        return { source: "local" };
      }

      await runGitCommand(["checkout", resolution.name], { cwd });
      return { source: "local" };
    }
    case "remote-only":
      await runGitCommand(["checkout", "-b", resolution.name, "--track", resolution.remoteRef], {
        cwd,
      });
      return { source: "remote" };
    default:
      return throwBranchNotFound(input.requestedBranch);
  }
}
