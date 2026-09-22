import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { PiCapturedUserMessageEntry } from "./history-mapper.js";
import type { PiRuntimeSession } from "./runtime.js";
import { isRecord, optionalString } from "./event-values.js";

const PI_PROVIDER = "pi";
export const CHISACODE_PI_TREE_EXTENSION_COMMAND = "chisacode_tree";
export const CHISACODE_PI_CAPTURE_EXTENSION_COMMAND = "chisacode_capture_entries";
export const CHISACODE_PI_ENTRY_CAPTURE_MARKER = "CHISACODE_ENTRY_CAPTURE";
export const CHISACODE_PI_COMMAND_RESULT_MARKER = "CHISACODE_COMMAND_RESULT";
const EXTENSION_RESULT_TIMEOUT_MS = 10_000;

/** Captured Pi user entry including its tree parent. */
export interface PiCapturedEntry extends PiCapturedUserMessageEntry {
  parentId: string | null;
}

interface PendingUserMessage {
  text: string;
  turnId: string | undefined;
}

interface PendingExtensionResult {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Dependencies used by the Pi extension history controller. */
export interface PiExtensionHistoryControllerOptions {
  runtimeSession: Pick<PiRuntimeSession, "prompt">;
  emit: (event: AgentStreamEvent) => void;
}

/** Owns Pi extension command results and captured user-entry alignment. */
export class PiExtensionHistoryController {
  private readonly capturedEntries: PiCapturedEntry[] = [];
  private readonly entriesById = new Map<string, PiCapturedEntry>();
  private readonly seenEntryIds = new Set<string>();
  private readonly pendingUserMessages: PendingUserMessage[] = [];
  private readonly pendingResults = new Map<string, PendingExtensionResult>();
  private readonly runtimeSession: Pick<PiRuntimeSession, "prompt">;
  private readonly emit: (event: AgentStreamEvent) => void;

  constructor(options: PiExtensionHistoryControllerOptions) {
    this.runtimeSession = options.runtimeSession;
    this.emit = options.emit;
  }

  get entries(): readonly PiCapturedEntry[] {
    return this.capturedEntries;
  }

  getEntry(messageId: string): PiCapturedEntry | undefined {
    return this.entriesById.get(messageId);
  }

  async capture(reason: string): Promise<void> {
    await this.runExtensionCommand(CHISACODE_PI_CAPTURE_EXTENSION_COMMAND, { reason });
  }

  async navigateTree(targetId: string): Promise<unknown> {
    return this.runExtensionCommand(CHISACODE_PI_TREE_EXTENSION_COMMAND, { targetId });
  }

  queueUserMessage(text: string, turnId: string | undefined): void {
    this.pendingUserMessages.push({ text, turnId });
    void this.capture("message_end").catch((error: unknown) => {
      this.emit({
        type: "turn_failed",
        provider: PI_PROVIDER,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  handleMarker(message: string): boolean {
    return this.handleEntryCaptureMarker(message) || this.handleCommandResultMarker(message);
  }

  close(error: Error): void {
    for (const requestId of this.pendingResults.keys()) {
      this.rejectResult(requestId, error);
    }
  }

  private async runExtensionCommand(
    command: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const requestId = randomUUID();
    const resultPromise = this.waitForResult(requestId);
    const payload = Buffer.from(JSON.stringify({ ...input, requestId })).toString("base64url");
    try {
      await this.runtimeSession.prompt(`/${command} ${payload}`);
    } catch (error) {
      const promptError = error instanceof Error ? error : new Error(String(error));
      this.discardResult(requestId);
      throw promptError;
    }
    return resultPromise;
  }

  private waitForResult(requestId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResults.delete(requestId);
        reject(new Error(`Pi extension result timed out for request ${requestId}`));
      }, EXTENSION_RESULT_TIMEOUT_MS);
      this.pendingResults.set(requestId, { resolve, reject, timer });
    });
  }

  private resolveResult(requestId: string, result: unknown): void {
    const pending = this.pendingResults.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingResults.delete(requestId);
    pending.resolve(result);
  }

  private rejectResult(requestId: string, error: Error): void {
    const pending = this.pendingResults.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingResults.delete(requestId);
    pending.reject(error);
  }

  private discardResult(requestId: string): void {
    const pending = this.pendingResults.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingResults.delete(requestId);
  }

  private recordEntries(entries: PiCapturedEntry[]): void {
    const previouslySeenEntryIds = new Set(this.seenEntryIds);
    this.capturedEntries.splice(0, this.capturedEntries.length, ...entries);
    this.entriesById.clear();
    for (const entry of entries) {
      this.entriesById.set(entry.id, entry);
    }
    this.flushPendingUserMessages(previouslySeenEntryIds);
    for (const entry of entries) {
      this.seenEntryIds.add(entry.id);
    }
  }

  private flushPendingUserMessages(previouslySeenEntryIds: Set<string>): void {
    for (let index = 0; index < this.pendingUserMessages.length; index += 1) {
      const pending = this.pendingUserMessages[index]!;
      const entry = this.capturedEntries.find(
        (candidate) => !previouslySeenEntryIds.has(candidate.id),
      );
      if (!entry) {
        continue;
      }
      previouslySeenEntryIds.add(entry.id);
      this.pendingUserMessages.splice(index, 1);
      index -= 1;
      this.emit({
        type: "timeline",
        provider: PI_PROVIDER,
        turnId: pending.turnId,
        item: {
          type: "user_message",
          text: pending.text,
          messageId: entry.id,
        },
      });
    }
  }

  private handleEntryCaptureMarker(message: string): boolean {
    const payload = parseExtensionMarkerPayload(message, CHISACODE_PI_ENTRY_CAPTURE_MARKER);
    if (!payload) {
      return false;
    }
    const entries = parseCapturedEntries(payload.entries);
    this.recordEntries(entries);
    if (typeof payload.requestId === "string") {
      this.resolveResult(payload.requestId, entries);
    }
    return true;
  }

  private handleCommandResultMarker(message: string): boolean {
    const payload = parseExtensionMarkerPayload(message, CHISACODE_PI_COMMAND_RESULT_MARKER);
    if (!payload) {
      return false;
    }
    if (typeof payload.requestId !== "string") {
      return true;
    }
    if (payload.ok === true) {
      this.resolveResult(payload.requestId, payload.result);
      return true;
    }
    const error = typeof payload.error === "string" ? payload.error : "Pi extension command failed";
    this.rejectResult(payload.requestId, new Error(error));
    return true;
  }
}

function parseExtensionMarkerPayload(
  message: string,
  marker: string,
): Record<string, unknown> | null {
  const prefix = `${marker} `;
  if (!message.startsWith(prefix)) {
    return null;
  }
  try {
    const parsed = JSON.parse(message.slice(prefix.length)) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCapturedEntries(value: unknown): PiCapturedEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): PiCapturedEntry[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = optionalString(entry.id)?.trim();
    const text = optionalString(entry.text);
    if (!id || text === undefined) {
      return [];
    }
    const parentId = entry.parentId === null ? null : optionalString(entry.parentId)?.trim();
    return [
      {
        id,
        parentId: parentId || null,
        text,
      },
    ];
  });
}
