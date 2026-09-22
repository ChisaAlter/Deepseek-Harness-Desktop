import { z } from "zod/v3";
import type { AgentManager } from "./agent/agent-manager.js";
import {
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
  generateStructuredAgentResponseWithFallback,
} from "./agent/agent-response-loop.js";
import {
  resolveStructuredGenerationProviders,
  type ResolveStructuredGenerationProvidersOptions,
  type StructuredGenerationDaemonConfig,
} from "./agent/structured-generation-providers.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { buildMetadataPrompt } from "../utils/build-metadata-prompt.js";
import { diffChangeTypeFor } from "./session-helpers.js";

const MAX_METADATA_FILES = 500;
const MAX_METADATA_PATH_CHARS = 512;
const COMMIT_PATCH_CHAR_BUDGET = 120_000;
const PULL_REQUEST_PATCH_CHAR_BUDGET = 200_000;

type CheckoutDiff = Awaited<ReturnType<WorkspaceGitService["getCheckoutDiff"]>>;
type CurrentSelection = ResolveStructuredGenerationProvidersOptions["currentSelection"];

interface GitMetadataGeneratorOptions {
  agentManager: AgentManager;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckoutDiff" | "resolveRepoRoot">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  readDaemonConfig(): StructuredGenerationDaemonConfig;
  getCurrentSelection(cwd: string): CurrentSelection;
}

/** Bounded prompt context derived from a workspace Git diff. */
export interface GitMetadataDiffContext {
  fileList: string;
  patch: string;
}

/**
 * Formats untrusted Git diff metadata within deterministic prompt-size boundaries.
 * @param diff Structured and textual checkout diff
 * @param maxPatchChars Maximum patch characters included in the prompt
 * @returns Bounded file-list and patch sections
 */
export function buildGitMetadataDiffContext(
  diff: CheckoutDiff,
  maxPatchChars: number,
): GitMetadataDiffContext {
  const files = diff.structured ?? [];
  const includedFiles = files.slice(0, MAX_METADATA_FILES);
  const fileList =
    includedFiles.length > 0
      ? [
          "Files changed:",
          ...includedFiles.map((file) => {
            const changeType = diffChangeTypeFor(file);
            const status = file.status && file.status !== "ok" ? ` [${file.status}]` : "";
            const path = sanitizeMetadataPath(file.path);
            return `${changeType}\t${path}\t(+${file.additions} -${file.deletions})${status}`;
          }),
          ...(files.length > includedFiles.length
            ? [`... (${files.length - includedFiles.length} more files omitted)`]
            : []),
        ].join("\n")
      : "Files changed: (unknown)";
  const patch =
    diff.diff.length > maxPatchChars
      ? `${diff.diff.slice(0, maxPatchChars)}\n\n... (diff truncated to ${maxPatchChars} chars)\n`
      : diff.diff;
  return { fileList, patch };
}

/** Generates commit messages and pull-request text through the shared structured-provider policy. */
export class GitMetadataGenerator {
  constructor(private readonly options: GitMetadataGeneratorOptions) {}

  async generateCommitMessage(cwd: string): Promise<string> {
    const diff = await this.options.workspaceGitService.getCheckoutDiff(cwd, {
      mode: "uncommitted",
      includeStructured: true,
    });
    const { fileList, patch } = buildGitMetadataDiffContext(diff, COMMIT_PATCH_CHAR_BUDGET);
    const prompt = await this.buildPrompt({
      cwd,
      configKey: "commitMessage",
      before: "Write a concise git commit message for the changes below.",
      contract: "Return JSON only with a single field 'message'.",
      fileList,
      patch,
    });
    const schema = z.object({
      message: z
        .string()
        .min(1)
        .max(72)
        .describe("Concise git commit message, imperative mood, no trailing period."),
    });

    try {
      const result = await generateStructuredAgentResponseWithFallback({
        manager: this.options.agentManager,
        cwd,
        prompt,
        schema,
        schemaName: "CommitMessage",
        maxRetries: 2,
        providers: await this.resolveProviders(cwd),
        persistSession: false,
        agentConfigOverrides: { title: "Commit generator", internal: true },
      });
      return result.message;
    } catch (error) {
      if (isStructuredGenerationFailure(error)) {
        return "Update files";
      }
      throw error;
    }
  }

  async generatePullRequestText(
    cwd: string,
    baseRef?: string,
  ): Promise<{ title: string; body: string }> {
    const diff = await this.options.workspaceGitService.getCheckoutDiff(cwd, {
      mode: "base",
      baseRef,
      includeStructured: true,
    });
    const { fileList, patch } = buildGitMetadataDiffContext(diff, PULL_REQUEST_PATCH_CHAR_BUDGET);
    const prompt = await this.buildPrompt({
      cwd,
      configKey: "pullRequest",
      before: "Write a pull request title and body for the changes below.",
      contract: "Return JSON only with fields 'title' and 'body'.",
      fileList,
      patch,
    });
    const schema = z.object({
      title: z.string().min(1).max(72),
      body: z.string().min(1),
    });

    try {
      return await generateStructuredAgentResponseWithFallback({
        manager: this.options.agentManager,
        cwd,
        prompt,
        schema,
        schemaName: "PullRequest",
        maxRetries: 2,
        providers: await this.resolveProviders(cwd),
        persistSession: false,
        agentConfigOverrides: { title: "PR generator", internal: true },
      });
    } catch (error) {
      if (isStructuredGenerationFailure(error)) {
        return {
          title: "Update changes",
          body: "Automated PR generated by ChisaCode.",
        };
      }
      throw error;
    }
  }

  private async buildPrompt(input: {
    cwd: string;
    configKey: "commitMessage" | "pullRequest";
    before: string;
    contract: string;
    fileList: string;
    patch: string;
  }): Promise<string> {
    return buildMetadataPrompt({
      cwd: input.cwd,
      workspaceGitService: this.options.workspaceGitService,
      configKey: input.configKey,
      before: input.before,
      after: [
        input.contract,
        "",
        input.fileList,
        "",
        input.patch.length > 0 ? input.patch : "(No diff available)",
      ].join("\n"),
    });
  }

  private async resolveProviders(cwd: string) {
    return resolveStructuredGenerationProviders({
      cwd,
      providerSnapshotManager: this.options.providerSnapshotManager,
      daemonConfig: this.options.readDaemonConfig(),
      currentSelection: this.options.getCurrentSelection(cwd),
    });
  }
}

function sanitizeMetadataPath(path: string): string {
  let escaped = "";
  for (const character of path) {
    const codePoint = character.codePointAt(0) ?? 0;
    escaped +=
      codePoint <= 0x1f || codePoint === 0x7f
        ? `\\x${codePoint.toString(16).padStart(2, "0")}`
        : character;
  }
  return escaped.length > MAX_METADATA_PATH_CHARS
    ? `${escaped.slice(0, MAX_METADATA_PATH_CHARS)}...`
    : escaped;
}

function isStructuredGenerationFailure(error: unknown): boolean {
  return (
    error instanceof StructuredAgentResponseError || error instanceof StructuredAgentFallbackError
  );
}
