import { z } from "zod/v3";
import type pino from "pino";

import { findExecutable } from "../utils/executable.js";
import { resolveGitHubRemote } from "../utils/github-remote.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { execCommand } from "../utils/spawn.js";
import { GitHubCurrentPullRequestPoller } from "./github-current-pr-poller.js";
import {
  loadGitHubCurrentPullRequestStatus,
  loadGitHubRepoView,
  type GitHubCurrentPullRequestStatus,
} from "./github-current-pr.js";
import {
  createGitHubPullRequest,
  disableGitHubPullRequestAutoMerge,
  enableGitHubPullRequestAutoMerge,
  mergeGitHubPullRequest,
  type CreateGitHubPullRequestOptions,
  type DisableGitHubPullRequestAutoMergeOptions,
  type EnableGitHubPullRequestAutoMergeOptions,
  type GitHubPullRequestAutoMergeResult,
  type GitHubPullRequestCreateResult,
  type GitHubPullRequestMergeResult,
  type MergeGitHubPullRequestOptions,
} from "./github-pr-mutations.js";
import {
  loadGitHubPullRequestTimeline,
  type GitHubPullRequestTimeline,
  type GitHubPullRequestTimelineFailure,
} from "./github-pr-timeline.js";
import {
  searchGitHubIssuesAndPrs,
  type GitHubReadOptions,
  type GitHubSearchResult,
  type SearchGitHubIssuesAndPrsOptions,
} from "./github-search.js";

export type {
  GitHubReadOptions,
  GitHubSearchResult,
  SearchGitHubIssuesAndPrsOptions,
} from "./github-search.js";
export type {
  GitHubCurrentPullRequestStatus,
  GitHubPullRequestStatusFacts,
  PullRequestMergeable,
  PullRequestReviewDecision,
} from "./github-current-pr.js";
export {
  assertPullRequestAutoMergeDisableReady,
  assertPullRequestAutoMergeEnableReady,
  isPullRequestMergeMethodAllowed,
} from "./github-pr-mutations.js";
export type {
  CreateGitHubPullRequestOptions,
  DisableGitHubPullRequestAutoMergeOptions,
  EnableGitHubPullRequestAutoMergeOptions,
  GitHubPullRequestAutoMergeResult,
  GitHubPullRequestCommandStatus,
  GitHubPullRequestCreateResult,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestMergeResult,
  MergeGitHubPullRequestOptions,
} from "./github-pr-mutations.js";
export { parseStatusCheckRollup } from "./github-pr-checks.js";
export type {
  PullRequestCheck,
  PullRequestChecksStatus,
  PullRequestCheckStatus,
} from "./github-pr-checks.js";
export type {
  GitHubPullRequestTimeline,
  GitHubPullRequestTimelineError,
  GitHubPullRequestTimelineErrorKind,
  PullRequestTimelineItem,
  PullRequestTimelineReviewState,
} from "./github-pr-timeline.js";

const DEFAULT_GITHUB_CACHE_TTL_MS = 30_000;
export const GITHUB_POLL_FAST_INTERVAL_MS = 20_000;
export const GITHUB_POLL_SLOW_INTERVAL_MS = 120_000;
export const GITHUB_POLL_ERROR_BACKOFF_CAP_MS = 300_000;
const GITHUB_ENV = {
  GIT_TERMINAL_PROMPT: "0",
} as const;

const LabelSchema = z.object({
  name: z.string().optional(),
});

const GitHubIssueSummarySchema = z.object({
  number: z.number(),
  title: z.string().catch(""),
  url: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  labels: z.array(LabelSchema).catch([]),
  updatedAt: z.string().catch(""),
});

const GitHubPullRequestSummarySchema = z.object({
  number: z.number(),
  title: z.string().catch(""),
  url: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  baseRefName: z.string().catch(""),
  headRefName: z.string().catch(""),
  labels: z.array(LabelSchema).catch([]),
  updatedAt: z.string().catch(""),
});

const PullRequestCheckoutTargetSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z
        .object({
          number: z.number(),
          baseRefName: z.string().catch(""),
          headRefName: z.string().catch(""),
          isCrossRepository: z.boolean().catch(false),
          headRepositoryOwner: z
            .object({
              login: z.string().catch(""),
            })
            .nullable()
            .optional(),
          headRepository: z
            .object({
              sshUrl: z.string().nullable().optional(),
              url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable(),
    }),
  }),
});

const PULL_REQUEST_CHECKOUT_TARGET_QUERY = `
query PullRequestCheckoutTarget($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      baseRefName
      headRefName
      isCrossRepository
      headRepositoryOwner {
        login
      }
      headRepository {
        sshUrl
        url
      }
    }
  }
}`;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  cwd: string;
}

interface GitHubServiceDependencies {
  runner: GitHubCommandRunner;
  resolveGhPath: () => Promise<string | null>;
  now: () => number;
}

export interface GitHubCommandRunnerOptions {
  cwd: string;
  envOverlay?: Record<string, string>;
}

export interface GitHubCommandResult {
  stdout: string;
  stderr: string;
}

export type GitHubCommandRunner = (
  args: string[],
  options: GitHubCommandRunnerOptions,
) => Promise<GitHubCommandResult>;

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string | null;
  baseRefName: string;
  headRefName: string;
  labels: string[];
  updatedAt: string;
}

export interface GitHubPullRequestCheckoutTarget {
  number: number;
  baseRefName: string;
  headRefName: string;
  headOwnerLogin: string | null;
  headRepositorySshUrl: string | null;
  headRepositoryUrl: string | null;
  isCrossRepository: boolean;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string | null;
  labels: string[];
  updatedAt: string;
}

export type ListGitHubPullRequestsOptions = {
  cwd: string;
  query?: string;
  limit?: number;
} & GitHubReadOptions;

export type ListGitHubIssuesOptions = {
  cwd: string;
  query?: string;
  limit?: number;
} & GitHubReadOptions;

export type GetGitHubPullRequestOptions = {
  cwd: string;
  number: number;
} & GitHubReadOptions;

export type GetGitHubPullRequestTimelineOptions = {
  cwd: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
} & GitHubReadOptions;

export interface GitHubService {
  listPullRequests(options: ListGitHubPullRequestsOptions): Promise<GitHubPullRequestSummary[]>;
  listIssues(options: ListGitHubIssuesOptions): Promise<GitHubIssueSummary[]>;
  getPullRequest(options: GetGitHubPullRequestOptions): Promise<GitHubPullRequestSummary>;
  getPullRequestHeadRef(options: GetGitHubPullRequestOptions): Promise<string>;
  getPullRequestCheckoutTarget?(
    options: GetGitHubPullRequestOptions,
  ): Promise<GitHubPullRequestCheckoutTarget>;
  getCurrentPullRequestStatus(
    options: {
      cwd: string;
      headRef: string;
      headRepositoryOwner?: string;
    } & GitHubReadOptions,
  ): Promise<GitHubCurrentPullRequestStatus | null>;
  getPullRequestTimeline(
    options: GetGitHubPullRequestTimelineOptions,
  ): Promise<GitHubPullRequestTimeline>;
  searchIssuesAndPrs(options: SearchGitHubIssuesAndPrsOptions): Promise<GitHubSearchResult>;
  createPullRequest(
    options: CreateGitHubPullRequestOptions,
  ): Promise<GitHubPullRequestCreateResult>;
  mergePullRequest(options: MergeGitHubPullRequestOptions): Promise<GitHubPullRequestMergeResult>;
  enablePullRequestAutoMerge(
    options: EnableGitHubPullRequestAutoMergeOptions,
  ): Promise<GitHubPullRequestAutoMergeResult>;
  disablePullRequestAutoMerge(
    options: DisableGitHubPullRequestAutoMergeOptions,
  ): Promise<GitHubPullRequestAutoMergeResult>;
  isAuthenticated(options: { cwd: string } & GitHubReadOptions): Promise<boolean>;
  retainCurrentPullRequestStatusPoll?(options: {
    cwd: string;
    headRef: string;
    onStatus?: (status: GitHubCurrentPullRequestStatus | null) => void;
    onError?: (error: unknown) => void;
  }): { unsubscribe: () => void };
  invalidate(options: { cwd: string }): void;
  dispose?(): void;
}

export class GitHubCliMissingError extends Error {
  readonly kind = "missing-cli";

  constructor() {
    super("GitHub CLI (gh) is not installed or not in PATH");
    this.name = "GitHubCliMissingError";
  }
}

export class GitHubAuthenticationError extends Error {
  readonly kind = "auth-failure";
  readonly stderr: string;

  constructor(params: { stderr: string }) {
    super("GitHub CLI authentication failed");
    this.name = "GitHubAuthenticationError";
    this.stderr = params.stderr;
  }
}

export class GitHubCommandError extends Error {
  readonly kind = "command-error";
  readonly args: string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(params: { args: string[]; cwd: string; exitCode: number | null; stderr: string }) {
    super(`GitHub CLI command failed: gh ${params.args.join(" ")}`);
    this.name = "GitHubCommandError";
    this.args = [...params.args];
    this.cwd = params.cwd;
    this.exitCode = params.exitCode;
    this.stderr = params.stderr;
  }
}

interface CreateGitHubServiceOptions {
  ttlMs?: number;
  runner?: GitHubCommandRunner;
  resolveGhPath?: () => Promise<string | null>;
  now?: () => number;
  logger?: Pick<pino.Logger, "warn">;
}

interface CommandFailureLike {
  code?: string | number | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  message?: string;
}

interface InFlightCacheEntry {
  cwd: string;
  promise: Promise<unknown>;
  force: boolean;
}

export function createGitHubService(options: CreateGitHubServiceOptions = {}): GitHubService {
  const ttlMs = options.ttlMs ?? DEFAULT_GITHUB_CACHE_TTL_MS;
  const deps: GitHubServiceDependencies = {
    runner: options.runner ?? runGhCommand,
    resolveGhPath: options.resolveGhPath ?? resolveGhPath,
    now: options.now ?? Date.now,
  };
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightCacheEntry>();
  let api!: GitHubService;
  const currentPullRequestPoller = new GitHubCurrentPullRequestPoller({
    loadStatus: (input) => api.getCurrentPullRequestStatus(input),
    computeNextInterval: computeGithubNextInterval,
    onSubscriberError: (error, context) => {
      options.logger?.warn(
        { err: error, ...context },
        "GitHub current pull request poll subscriber threw",
      );
    },
  });

  async function cached<T>(params: {
    cwd: string;
    method: string;
    args: unknown;
    readOptions?: GitHubReadOptions;
    load: () => Promise<T>;
  }): Promise<T> {
    if (params.readOptions?.force && !params.readOptions.reason) {
      throw new Error("GitHubService forced read requires a reason");
    }

    const key = buildCacheKey({
      cwd: params.cwd,
      method: params.method,
      args: params.args,
    });
    const cachedEntry = cache.get(key);
    const now = deps.now();
    if (!params.readOptions?.force && cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.value as T;
    }

    const existing = inFlight.get(key);
    if (existing && (!params.readOptions?.force || existing.force)) {
      return existing.promise as Promise<T>;
    }

    const request = params
      .load()
      .then((value) => {
        if (inFlight.get(key)?.promise === request) {
          cache.set(key, {
            value,
            cwd: params.cwd,
            expiresAt: deps.now() + ttlMs,
          });
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(key)?.promise === request) {
          inFlight.delete(key);
        }
      });
    inFlight.set(key, {
      cwd: params.cwd,
      promise: request,
      force: params.readOptions?.force === true,
    });
    return request;
  }

  async function run(args: string[], runOptions: GitHubCommandRunnerOptions): Promise<string> {
    const ghPath = await deps.resolveGhPath();
    if (!ghPath) {
      throw new GitHubCliMissingError();
    }
    try {
      const result = await deps.runner(args, runOptions);
      return result.stdout.trim();
    } catch (error) {
      throw normalizeGitHubCommandError(error, {
        args,
        cwd: runOptions.cwd,
      });
    }
  }

  api = {
    listPullRequests(input) {
      return cached({
        cwd: input.cwd,
        method: "listPullRequests",
        args: { query: input.query ?? "", limit: input.limit ?? 20 },
        readOptions: input,
        load: async () => {
          const stdout = await run(
            [
              "pr",
              "list",
              "--search",
              input.query ?? "",
              "--json",
              "number,title,url,state,body,labels,baseRefName,headRefName,updatedAt",
              "--limit",
              String(input.limit ?? 20),
            ],
            { cwd: input.cwd },
          );
          return parsePullRequestSummaries(stdout);
        },
      });
    },

    listIssues(input) {
      return cached({
        cwd: input.cwd,
        method: "listIssues",
        args: { query: input.query ?? "", limit: input.limit ?? 20 },
        readOptions: input,
        load: async () => {
          const stdout = await run(
            [
              "issue",
              "list",
              "--search",
              input.query ?? "",
              "--json",
              "number,title,url,state,body,labels,updatedAt",
              "--limit",
              String(input.limit ?? 20),
            ],
            { cwd: input.cwd },
          );
          return parseIssueSummaries(stdout);
        },
      });
    },

    getPullRequest(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequest",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const stdout = await run(
            [
              "pr",
              "view",
              String(input.number),
              "--json",
              "number,title,url,state,body,labels,baseRefName,headRefName,updatedAt",
            ],
            { cwd: input.cwd },
          );
          return parsePullRequestSummary(stdout);
        },
      });
    },

    async getPullRequestHeadRef(input) {
      const pullRequest = await this.getPullRequest(input);
      return pullRequest.headRefName;
    },

    getPullRequestCheckoutTarget(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequestCheckoutTarget",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const repo = await loadGitHubRepoView({ cwd: input.cwd, run });
          const owner = repo?.owner?.login;
          const name = repo?.name;
          if (!owner || !name) {
            throw new Error("Unable to resolve GitHub repository for pull request checkout");
          }

          const stdout = await run(
            [
              "api",
              "graphql",
              "-f",
              `query=${PULL_REQUEST_CHECKOUT_TARGET_QUERY}`,
              "-F",
              `owner=${owner}`,
              "-F",
              `name=${name}`,
              "-F",
              `number=${input.number}`,
            ],
            { cwd: input.cwd },
          );
          return parsePullRequestCheckoutTarget(stdout);
        },
      });
    },

    getCurrentPullRequestStatus(input) {
      return cached({
        cwd: input.cwd,
        method: "getCurrentPullRequestStatus",
        args: {
          headRef: input.headRef,
          headRepositoryOwner: input.headRepositoryOwner,
        },
        readOptions: input,
        load: async () => {
          return loadGitHubCurrentPullRequestStatus(
            {
              cwd: input.cwd,
              headRef: input.headRef,
              headRepositoryOwner: input.headRepositoryOwner,
            },
            {
              run,
              isCommandError: (error) => error instanceof GitHubCommandError,
              isNoPullRequestFoundError,
              isStatusCheckRollupPermissionError,
            },
          );
        },
      }).then((status) => {
        currentPullRequestPoller.acceptStatus({
          cwd: input.cwd,
          headRef: input.headRef,
          status,
          notify: input.reason === "self-heal-github",
        });
        return status;
      });
    },

    getPullRequestTimeline(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequestTimeline",
        args: {
          prNumber: input.prNumber,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
        },
        readOptions: input,
        load: () =>
          loadGitHubPullRequestTimeline(input, {
            run,
            normalizeFailure: normalizeGitHubPullRequestTimelineFailure,
          }),
      });
    },

    searchIssuesAndPrs(input) {
      return searchGitHubIssuesAndPrs(input, {
        listIssues: (readOptions) => api.listIssues(readOptions),
        listPullRequests: (readOptions) => api.listPullRequests(readOptions),
        isFeatureUnavailableError: (error) =>
          error instanceof GitHubCliMissingError || error instanceof GitHubAuthenticationError,
      });
    },

    createPullRequest(input) {
      return createGitHubPullRequest(input, { run });
    },

    mergePullRequest(input) {
      return mergeGitHubPullRequest(input, { run });
    },

    enablePullRequestAutoMerge(input) {
      return enableGitHubPullRequestAutoMerge(input, { run });
    },

    disablePullRequestAutoMerge(input) {
      return disableGitHubPullRequestAutoMerge(input, { run });
    },

    isAuthenticated(input) {
      return cached({
        cwd: input.cwd,
        method: "isAuthenticated",
        args: {},
        readOptions: input,
        load: async () => {
          try {
            await run(["auth", "status"], { cwd: input.cwd });
            return true;
          } catch (error) {
            if (isGitHubAuthenticationError(error)) {
              throw error;
            }
            if (error instanceof GitHubCommandError && isAuthFailureText(error.stderr)) {
              throw new GitHubAuthenticationError({ stderr: error.stderr });
            }
            throw error;
          }
        },
      });
    },

    retainCurrentPullRequestStatusPoll(input) {
      return currentPullRequestPoller.retain(input);
    },

    invalidate(input) {
      // Local checkout mutations that can alter the current PR identity or PR status
      // must call this with the affected cwd before broadcasting fresh git state.
      for (const [key, entry] of cache.entries()) {
        if (entry.cwd === input.cwd) {
          cache.delete(key);
        }
      }
      for (const [key, entry] of inFlight.entries()) {
        if (entry.cwd === input.cwd) {
          inFlight.delete(key);
        }
      }
    },

    dispose() {
      currentPullRequestPoller.dispose();
    },
  };

  return api;
}

export function computeGithubNextInterval(
  status: GitHubCurrentPullRequestStatus | null,
  consecutiveErrors: number,
): number {
  const baseInterval = isGitHubStatusPending(status)
    ? GITHUB_POLL_FAST_INTERVAL_MS
    : GITHUB_POLL_SLOW_INTERVAL_MS;
  if (consecutiveErrors <= 1) {
    return baseInterval;
  }

  return Math.min(baseInterval * 2 ** (consecutiveErrors - 1), GITHUB_POLL_ERROR_BACKOFF_CAP_MS);
}

function isGitHubStatusPending(status: GitHubCurrentPullRequestStatus | null): boolean {
  if (!status) {
    return false;
  }
  if (status.checksStatus === "pending") {
    return true;
  }
  return status.checks.some((check) => check.status === "pending");
}

async function resolveGhPath(): Promise<string | null> {
  return findExecutable("gh");
}

async function runGhCommand(
  args: string[],
  options: GitHubCommandRunnerOptions,
): Promise<GitHubCommandResult> {
  return execCommand("gh", args, {
    cwd: options.cwd,
    envOverlay: { ...GITHUB_ENV, ...options.envOverlay },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 8_000,
  });
}

function buildCacheKey(params: { cwd: string; method: string; args: unknown }): string {
  return `${params.cwd}:${params.method}:${stableStringify(params.args)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const sorted: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    sorted[key] = sortJsonValue(entryValue);
  }
  return sorted;
}

function normalizeGitHubCommandError(
  error: unknown,
  context: { args: string[]; cwd: string },
): Error {
  if (error instanceof GitHubAuthenticationError) {
    return error;
  }
  if (error instanceof GitHubCommandError) {
    if (isAuthFailureText(error.stderr)) {
      return new GitHubAuthenticationError({ stderr: error.stderr });
    }
    return error;
  }
  const failure = toCommandFailureLike(error);
  if (failure.code === "ENOENT") {
    return new GitHubCliMissingError();
  }
  const stderr = bufferOrStringToString(failure.stderr);
  const message = failure.message ?? "";
  if (isAuthFailureText(stderr) || isAuthFailureText(message)) {
    return new GitHubAuthenticationError({ stderr });
  }
  return new GitHubCommandError({
    args: context.args,
    cwd: context.cwd,
    exitCode: typeof failure.code === "number" ? failure.code : null,
    stderr: stderr || message,
  });
}

function toCommandFailureLike(error: unknown): CommandFailureLike {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const record = error as Record<string, unknown>;
  return {
    code:
      typeof record.code === "string" || typeof record.code === "number" || record.code === null
        ? record.code
        : undefined,
    stderr:
      typeof record.stderr === "string" || Buffer.isBuffer(record.stderr)
        ? record.stderr
        : undefined,
    stdout:
      typeof record.stdout === "string" || Buffer.isBuffer(record.stdout)
        ? record.stdout
        : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

function bufferOrStringToString(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return value ?? "";
}

function isGitHubAuthenticationError(error: unknown): error is GitHubAuthenticationError {
  return error instanceof GitHubAuthenticationError;
}

function normalizeGitHubPullRequestTimelineFailure(
  error: unknown,
): GitHubPullRequestTimelineFailure {
  if (error instanceof GitHubCommandError) {
    return { kind: "command", stderr: error.stderr, message: error.message };
  }
  if (error instanceof GitHubAuthenticationError) {
    return { kind: "authentication", stderr: error.stderr, message: error.message };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

function isAuthFailureText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("gh auth login") ||
    normalized.includes("not logged into any github hosts") ||
    normalized.includes("authentication failed") ||
    normalized.includes("authentication required") ||
    normalized.includes("bad credentials") ||
    normalized.includes("http 401")
  );
}

function isNoPullRequestFoundError(error: unknown): boolean {
  if (!(error instanceof GitHubCommandError)) {
    return false;
  }
  const text = error.stderr.toLowerCase();
  return text.includes("no pull requests found");
}

function isStatusCheckRollupPermissionError(error: unknown): boolean {
  if (!(error instanceof GitHubCommandError)) {
    return false;
  }
  return error.stderr.toLowerCase().includes("statuscheckrollup");
}

function parsePullRequestSummaries(stdout: string): GitHubPullRequestSummary[] {
  const parsed = z.array(GitHubPullRequestSummarySchema).parse(JSON.parse(stdout || "[]"));
  return parsed.map(toPullRequestSummary);
}

function parsePullRequestSummary(stdout: string): GitHubPullRequestSummary {
  return toPullRequestSummary(GitHubPullRequestSummarySchema.parse(JSON.parse(stdout || "{}")));
}

function parsePullRequestCheckoutTarget(stdout: string): GitHubPullRequestCheckoutTarget {
  const parsed = PullRequestCheckoutTargetSchema.parse(JSON.parse(stdout || "{}"));
  const pullRequest = parsed.data.repository.pullRequest;
  if (!pullRequest) {
    throw new Error("Pull request not found");
  }
  return {
    number: pullRequest.number,
    baseRefName: pullRequest.baseRefName,
    headRefName: pullRequest.headRefName,
    headOwnerLogin: pullRequest.headRepositoryOwner?.login || null,
    headRepositorySshUrl: pullRequest.headRepository?.sshUrl || null,
    headRepositoryUrl: pullRequest.headRepository?.url || null,
    isCrossRepository: pullRequest.isCrossRepository,
  };
}

function toPullRequestSummary(
  item: z.infer<typeof GitHubPullRequestSummarySchema>,
): GitHubPullRequestSummary {
  return {
    number: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    body: item.body,
    baseRefName: item.baseRefName,
    headRefName: item.headRefName,
    labels: item.labels.map((label) => label.name ?? "").filter((name) => name.length > 0),
    updatedAt: item.updatedAt,
  };
}

function parseIssueSummaries(stdout: string): GitHubIssueSummary[] {
  const parsed = z.array(GitHubIssueSummarySchema).parse(JSON.parse(stdout || "[]"));
  return parsed.map((item) => ({
    number: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    body: item.body,
    labels: item.labels.map((label) => label.name ?? "").filter((name) => name.length > 0),
    updatedAt: item.updatedAt,
  }));
}

export async function resolveGitHubRepo(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const remote = await resolveGitHubRemote({ remoteUrl: stdout.trim() });
    return remote?.repo ?? null;
  } catch {
    return null;
  }
}
