import { randomUUID } from "node:crypto";
import type { PermissionMode, SDKMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentRuntimeInfo,
  AgentTimelineItem,
} from "../../agent-sdk-types.js";
import type { ClaudeAgentConfig } from "./client.js";
import { normalizeClaudeRuntimeModelId } from "./models.js";
import { extractSessionIdRaw } from "./sdk-types-mapping.js";

export interface ClaudeSessionCapture {
  threadStartedSessionId: string | null;
  notice: AgentTimelineItem | null;
}

interface ClaudeSystemCapture {
  capture: ClaudeSessionCapture;
  permissionMode: PermissionMode | null;
}

interface ClaudeSessionIdentityOptions {
  config: ClaudeAgentConfig;
  handle?: AgentPersistenceHandle;
  logger: Logger;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function emptyCapture(): ClaudeSessionCapture {
  return { threadStartedSessionId: null, notice: null };
}

export class ClaudeSessionIdentityController {
  private sessionId: string | null;
  private persistence: AgentPersistenceHandle | null;
  private cachedRuntimeInfo: AgentRuntimeInfo | null = null;
  private lastOptionsModel: string | null = null;
  private lastRuntimeModel: string | null = null;
  private modelGatewayOverrideActive = false;
  private pendingFreshSessionId: string | null = null;

  constructor(private readonly options: ClaudeSessionIdentityOptions) {
    const handle = options.handle;
    if (handle && !handle.sessionId) {
      throw new Error("Cannot resume: persistence handle has no sessionId");
    }
    this.sessionId = handle?.sessionId ?? null;
    this.persistence = handle ?? null;
  }

  get id(): string | null {
    return this.sessionId;
  }

  get pendingFreshId(): string | null {
    return this.pendingFreshSessionId;
  }

  getRuntimeInfo(modeId: string | null): AgentRuntimeInfo {
    if (!this.cachedRuntimeInfo) {
      this.cachedRuntimeInfo = this.buildRuntimeInfo(modeId);
    }
    return { ...this.cachedRuntimeInfo };
  }

  rememberRunCompleted(modeId: string | null): void {
    this.cachedRuntimeInfo = this.buildRuntimeInfo(modeId);
  }

  beforeQueryCreate(): void {
    this.persistence = null;
  }

  captureQueryOptions(input: {
    requestedModel: string | null;
    modelGatewayOverrideActive: boolean;
  }): void {
    this.lastOptionsModel = input.requestedModel;
    this.modelGatewayOverrideActive = input.modelGatewayOverrideActive;
    this.cachedRuntimeInfo = null;
  }

  recordModelSelection(modelId: string | null): void {
    this.lastOptionsModel = modelId;
    this.lastRuntimeModel = null;
    this.cachedRuntimeInfo = null;
    this.persistence = null;
  }

  invalidateRuntimeInfo(): void {
    this.cachedRuntimeInfo = null;
  }

  invalidateMissingResume(): void {
    this.persistence = null;
    this.cachedRuntimeInfo = null;
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (this.persistence) {
      return this.persistence;
    }
    if (!this.sessionId) {
      return null;
    }
    this.persistence = {
      provider: "claude",
      sessionId: this.sessionId,
      nativeHandle: this.sessionId,
      metadata: { ...this.options.config },
    };
    return this.persistence;
  }

  startFreshSession(): string {
    const sessionId = randomUUID();
    this.sessionId = sessionId;
    this.pendingFreshSessionId = sessionId;
    this.persistence = null;
    this.cachedRuntimeInfo = null;
    return sessionId;
  }

  rebindSession(sessionId: string): ClaudeSessionCapture {
    const oldSessionId = this.sessionId;
    this.sessionId = sessionId;
    this.pendingFreshSessionId = null;
    this.persistence = null;
    this.cachedRuntimeInfo = null;
    if (!oldSessionId || oldSessionId === sessionId) {
      return emptyCapture();
    }
    return {
      threadStartedSessionId: sessionId,
      notice: this.createSessionChangedNotice(oldSessionId, sessionId),
    };
  }

  captureSessionIdFromMessage(message: SDKMessage): ClaudeSessionCapture {
    const msgRecord = toObjectRecord(message) ?? {};
    const sessionId = extractSessionIdRaw({
      session_id: msgRecord.session_id,
      sessionId: msgRecord.sessionId,
      session: isObjectRecord(msgRecord.session) ? { id: msgRecord.session.id } : null,
    }).trim();
    return this.acceptSessionId(sessionId, "message");
  }

  captureSystemMessage(message: SDKSystemMessage): ClaudeSystemCapture {
    if (message.subtype !== "init") {
      return { capture: emptyCapture(), permissionMode: null };
    }

    const msgRecord = toObjectRecord(message) ?? {};
    const newSessionId = extractSessionIdRaw({
      session_id: msgRecord.session_id,
      sessionId: msgRecord.sessionId,
      session: isObjectRecord(msgRecord.session) ? { id: msgRecord.session.id } : null,
    }).trim();
    if (!newSessionId) {
      return { capture: emptyCapture(), permissionMode: null };
    }

    const capture = this.acceptSessionId(newSessionId, "init");
    if (message.model) {
      const normalizedRuntimeModel = normalizeClaudeRuntimeModelId(message.model);
      this.options.logger.debug(
        { runtimeModel: message.model, normalizedRuntimeModel },
        "Captured runtime model from SDK init",
      );
      if (this.modelGatewayOverrideActive) {
        this.lastOptionsModel =
          this.options.config.model ?? normalizedRuntimeModel ?? this.lastOptionsModel;
      } else if (normalizedRuntimeModel) {
        this.lastOptionsModel = normalizedRuntimeModel;
      } else if (!this.lastOptionsModel) {
        this.lastOptionsModel = this.options.config.model ?? null;
      }
      this.lastRuntimeModel = message.model;
      this.cachedRuntimeInfo = null;
    }

    return { capture, permissionMode: message.permissionMode };
  }

  private buildRuntimeInfo(modeId: string | null): AgentRuntimeInfo {
    return {
      provider: "claude",
      sessionId: this.sessionId,
      model: this.lastOptionsModel,
      modeId,
      ...(this.lastRuntimeModel
        ? {
            extra: {
              runtimeModel: this.lastRuntimeModel,
            },
          }
        : {}),
    };
  }

  private acceptSessionId(sessionId: string, source: "message" | "init"): ClaudeSessionCapture {
    if (!sessionId) {
      return emptyCapture();
    }
    const existingSessionId = this.sessionId;
    if (existingSessionId === null) {
      this.sessionId = sessionId;
      this.pendingFreshSessionId = null;
      this.persistence = null;
      this.cachedRuntimeInfo = null;
      if (source === "init") {
        this.options.logger.debug({ sessionId }, "Claude session ID set for the first time");
      }
      return { threadStartedSessionId: sessionId, notice: null };
    }
    if (existingSessionId === sessionId) {
      this.pendingFreshSessionId = null;
      if (source === "init") {
        this.options.logger.debug({ sessionId }, "Claude session ID unchanged (same value)");
      }
      return emptyCapture();
    }

    const sourceLabel = source === "init" ? "init message" : "message";
    this.options.logger.warn(
      { existingSessionId, newSessionId: sessionId },
      `Claude session ID changed in ${sourceLabel}; accepting new session`,
    );
    this.sessionId = sessionId;
    this.pendingFreshSessionId = null;
    this.persistence = null;
    this.cachedRuntimeInfo = null;
    return {
      threadStartedSessionId: sessionId,
      notice: this.createSessionChangedNotice(existingSessionId, sessionId),
    };
  }

  private createSessionChangedNotice(
    oldSessionId: string,
    newSessionId: string,
  ): AgentTimelineItem {
    return {
      type: "assistant_message",
      text: `Claude switched to a new session: ${oldSessionId} -> ${newSessionId}`,
    };
  }
}
