import { loadCodexThreadHistoryTimeline, type PersistedTimelineEntry } from "./history.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

interface CodexHistoryClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

interface CodexSessionHistoryOptions {
  getClient: () => CodexHistoryClient | null;
  getThreadId: () => string | null;
  getCwd: () => string | null;
  userMessageTurns: CodexUserMessageTurnState;
}

export class CodexSessionHistory {
  private pending = false;
  private entries: PersistedTimelineEntry[] = [];

  constructor(private readonly options: CodexSessionHistoryOptions) {}

  markPending(): void {
    this.pending = true;
  }

  async load(): Promise<void> {
    const client = this.options.getClient();
    const threadId = this.options.getThreadId();
    if (!client || !threadId) return;

    const timeline = await loadCodexThreadHistoryTimeline({
      threadId,
      cwd: this.options.getCwd(),
      requestThread: (threadIdToRead) =>
        client.request("thread/read", {
          threadId: threadIdToRead,
          includeTurns: true,
        }),
    });
    this.options.userMessageTurns.reset();
    for (const entry of timeline) {
      if (entry.item.type === "user_message") {
        this.options.userMessageTurns.remember(entry.item.messageId);
      }
    }
    if (timeline.length > 0) {
      this.entries = timeline;
      this.pending = true;
    }
  }

  drain(): PersistedTimelineEntry[] {
    if (!this.pending || this.entries.length === 0) {
      return [];
    }
    const entries = this.entries;
    this.entries = [];
    this.pending = false;
    return entries;
  }

  reset(): void {
    this.entries = [];
    this.pending = false;
  }
}
