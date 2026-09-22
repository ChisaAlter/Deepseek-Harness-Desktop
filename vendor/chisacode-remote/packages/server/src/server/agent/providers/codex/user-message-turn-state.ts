import type { CodexUserMessageTurnIndex } from "./rewind.js";

/** Tracks stable Codex user-message ordering for rewind and rollback operations. */
export class CodexUserMessageTurnState implements CodexUserMessageTurnIndex {
  private readonly indexByMessageId = new Map<string, number>();
  private readonly messageIds: string[] = [];

  remember(messageId: string | null | undefined): boolean {
    if (typeof messageId !== "string" || messageId.length === 0) {
      return false;
    }
    if (this.indexByMessageId.has(messageId)) {
      return false;
    }
    this.indexByMessageId.set(messageId, this.messageIds.length);
    this.messageIds.push(messageId);
    return true;
  }

  reset(): void {
    this.indexByMessageId.clear();
    this.messageIds.length = 0;
  }

  truncate(numTurns: number): void {
    if (numTurns <= 0) {
      return;
    }
    this.messageIds.length = Math.max(0, this.messageIds.length - numTurns);
    this.indexByMessageId.clear();
    this.messageIds.forEach((messageId, index) => {
      this.indexByMessageId.set(messageId, index);
    });
  }

  resolve(messageId: string): number | null {
    return this.indexByMessageId.get(messageId) ?? null;
  }

  count(): number {
    return this.messageIds.length;
  }
}
