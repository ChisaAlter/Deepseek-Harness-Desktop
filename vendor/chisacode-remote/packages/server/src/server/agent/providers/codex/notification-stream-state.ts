/** Owns Codex notification buffers, lifecycle dedupe, and terminal correlation state. */
export class CodexNotificationStreamState {
  private readonly assistantTextByItemId = new Map<string, string>();
  private readonly reasoningChunksByItemId = new Map<string, string[]>();
  private readonly commandOutputByCallId = new Map<string, string[]>();
  private readonly fileChangeOutputByItemId = new Map<string, string[]>();
  private readonly terminalCommandByProcessId = new Map<string, string>();
  private readonly pendingUnlabeledTerminalInteractions = new Set<string>();
  private readonly emittedTerminalInteractionKeys = new Set<string>();
  private readonly emittedExecCommandStartedCallIds = new Set<string>();
  private readonly emittedExecCommandCompletedCallIds = new Set<string>();
  private readonly emittedItemStartedIds = new Set<string>();
  private readonly emittedItemCompletedIds = new Set<string>();
  private readonly warnedIncompleteEditToolCallIds = new Set<string>();

  appendAssistantDelta(itemId: string, delta: string): { previous: string; text: string } {
    const previous = this.assistantTextByItemId.get(itemId) ?? "";
    const text = previous + delta;
    this.assistantTextByItemId.set(itemId, text);
    return { previous, text };
  }

  appendReasoningDelta(itemId: string, delta: string): string {
    const chunks = this.reasoningChunksByItemId.get(itemId) ?? [];
    chunks.push(delta);
    this.reasoningChunksByItemId.set(itemId, chunks);
    return chunks.join("");
  }

  peekAssistantText(itemId: string): string | null {
    return this.assistantTextByItemId.get(itemId) ?? null;
  }

  peekReasoningText(itemId: string): string | null {
    const chunks = this.reasoningChunksByItemId.get(itemId);
    return chunks ? chunks.join("") : null;
  }

  consumeAssistantText(itemId: string): string | null {
    const text = this.peekAssistantText(itemId);
    this.assistantTextByItemId.delete(itemId);
    return text;
  }

  consumeReasoningText(itemId: string): string | null {
    const text = this.peekReasoningText(itemId);
    this.reasoningChunksByItemId.delete(itemId);
    return text;
  }

  appendCommandOutput(callId: string | null | undefined, chunk: string | null | undefined): void {
    this.appendOutput(this.commandOutputByCallId, callId, chunk);
  }

  appendFileChangeOutput(
    itemId: string | null | undefined,
    chunk: string | null | undefined,
  ): void {
    this.appendOutput(this.fileChangeOutputByItemId, itemId, chunk);
  }

  consumeCommandOutput(callId: string | null | undefined): string | null {
    return this.consumeOutput(this.commandOutputByCallId, callId);
  }

  consumeFileChangeOutput(itemId: string | null | undefined): string | null {
    return this.consumeOutput(this.fileChangeOutputByItemId, itemId);
  }

  clearCommandOutput(callId: string | null | undefined): void {
    if (callId) this.commandOutputByCallId.delete(callId);
  }

  clearFileChangeOutput(itemId: string | null | undefined): void {
    if (itemId) this.fileChangeOutputByItemId.delete(itemId);
  }

  clearItem(itemId: string): void {
    this.assistantTextByItemId.delete(itemId);
    this.reasoningChunksByItemId.delete(itemId);
    this.commandOutputByCallId.delete(itemId);
    this.fileChangeOutputByItemId.delete(itemId);
  }

  markExecCommandStarted(callId: string): void {
    this.emittedExecCommandStartedCallIds.add(callId);
  }

  hasExecCommandStarted(callId: string): boolean {
    return this.emittedExecCommandStartedCallIds.has(callId);
  }

  markExecCommandCompleted(callId: string): void {
    this.emittedExecCommandCompletedCallIds.add(callId);
  }

  hasExecCommandCompleted(callId: string): boolean {
    return this.emittedExecCommandCompletedCallIds.has(callId);
  }

  markItemStarted(itemId: string): void {
    this.emittedItemStartedIds.add(itemId);
  }

  hasItemStarted(itemId: string): boolean {
    return this.emittedItemStartedIds.has(itemId);
  }

  clearItemStarted(itemId: string): void {
    this.emittedItemStartedIds.delete(itemId);
  }

  markItemCompleted(itemId: string): void {
    this.emittedItemCompletedIds.add(itemId);
  }

  hasItemCompleted(itemId: string): boolean {
    return this.emittedItemCompletedIds.has(itemId);
  }

  resolveTerminalCommand(processId: string): string | null {
    return this.terminalCommandByProcessId.get(processId) ?? null;
  }

  markPendingTerminalInteraction(processId: string): void {
    this.pendingUnlabeledTerminalInteractions.add(processId);
  }

  rememberTerminalCommand(processId: string, command: string): boolean {
    this.terminalCommandByProcessId.set(processId, command);
    const hadPendingInteraction = this.pendingUnlabeledTerminalInteractions.has(processId);
    this.pendingUnlabeledTerminalInteractions.delete(processId);
    return hadPendingInteraction;
  }

  shouldEmitTerminalInteraction(key: string): boolean {
    if (this.emittedTerminalInteractionKeys.has(key)) return false;
    this.emittedTerminalInteractionKeys.add(key);
    return true;
  }

  shouldWarnIncompleteEdit(key: string): boolean {
    if (this.warnedIncompleteEditToolCallIds.has(key)) return false;
    this.warnedIncompleteEditToolCallIds.add(key);
    return true;
  }

  resetTurn(): void {
    this.emittedItemStartedIds.clear();
    this.emittedItemCompletedIds.clear();
    this.emittedExecCommandStartedCallIds.clear();
    this.emittedExecCommandCompletedCallIds.clear();
    this.assistantTextByItemId.clear();
    this.reasoningChunksByItemId.clear();
    this.commandOutputByCallId.clear();
    this.fileChangeOutputByItemId.clear();
    this.warnedIncompleteEditToolCallIds.clear();
  }

  private appendOutput(
    store: Map<string, string[]>,
    id: string | null | undefined,
    chunk: string | null | undefined,
  ): void {
    if (!id || !chunk) return;
    const chunks = store.get(id) ?? [];
    chunks.push(chunk);
    store.set(id, chunks);
  }

  private consumeOutput(
    store: Map<string, string[]>,
    id: string | null | undefined,
  ): string | null {
    if (!id) return null;
    const chunks = store.get(id);
    if (!chunks || chunks.length === 0) return null;
    store.delete(id);
    return chunks.join("");
  }
}
