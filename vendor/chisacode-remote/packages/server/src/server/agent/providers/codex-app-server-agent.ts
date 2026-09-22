import type { Logger } from "pino";

import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import {
  CodexAppServerAgentClient as CodexAppServerAgentClientImpl,
  type CodexAppServerAgentDeps,
  type CodexSessionFactoryInput,
} from "./codex/client.js";
import { CodexAppServerAgentSession } from "./codex/session.js";

export {
  buildCodexAppServerEnv,
  cleanupStaleCodexImageAttachments,
  codexAppServerTurnInputFromPrompt,
  CodexAppServerAgentSession,
  findCodexMicrosoftStoreBinary,
  findDefaultCodexBinary,
  forkCodexThread,
  formatCodexQuestionPrompts,
  listCodexSkillEntries,
  listCodexSkills,
  mapCodexPatchNotificationToToolCall,
  mapCodexPlanToToolCall,
  mapCodexQuestionRequestToToolCall,
  normalizeCodexOutputSchema,
  normalizeCodexQuestionPrompts,
  planStepsToMarkdown,
  rollbackCodexThread,
  threadItemToTimeline,
  toAgentUsage,
} from "./codex/session.js";

function createCodexSession(input: CodexSessionFactoryInput): CodexAppServerAgentSession {
  return new CodexAppServerAgentSession(
    input.config,
    input.resumeHandle,
    input.logger,
    input.spawnAppServer,
    input.deps,
    input.ephemeral,
    input.goalsEnabled,
    input.autoReviewEnabled,
    input.agentId,
  );
}

export class CodexAppServerAgentClient extends CodexAppServerAgentClientImpl {
  constructor(
    logger: Logger,
    runtimeSettings?: ProviderRuntimeSettings,
    deps: CodexAppServerAgentDeps = {},
  ) {
    super(logger, runtimeSettings, deps, createCodexSession);
  }
}
