import { ClaudeAgentClientRuntime, type ClaudeAgentClientOptions } from "./client.js";
import { ClaudeAgentSession } from "./session.js";

export { convertClaudeHistoryEntry, extractUserMessageText } from "./history-converter.js";
export { readEventIdentifiers } from "./message-router.js";
export { normalizeClaudeAskUserQuestionUpdatedInput } from "./sdk-types-mapping.js";
export type { ClaudeContentChunk } from "./sdk-types-mapping.js";

export class ClaudeAgentClient extends ClaudeAgentClientRuntime {
  constructor(options: ClaudeAgentClientOptions) {
    super({
      ...options,
      sessionFactory: (config, sessionOptions) => new ClaudeAgentSession(config, sessionOptions),
    });
  }
}
