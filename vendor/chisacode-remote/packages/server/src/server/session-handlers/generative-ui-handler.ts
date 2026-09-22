/** Handles canonical and legacy generative UI action requests. */

import { GenerativeUiActionResponseSchema } from "@chisacode/protocol/generative-ui/rpc-schemas";
import { type SessionInboundMessage } from "@chisacode/protocol/messages";
import type { DisposableHandler, GenerativeUiHandlerContext } from "./session-context.js";
import {
  GenerativeUiActionQueueFullError,
  getGenerativeUiActionPayloadBytes,
  MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES,
} from "../agent/generative-ui-action-queue.js";

export const MAX_GENERATIVE_UI_INSTANCE_ID_LENGTH = 256;
export const MAX_GENERATIVE_UI_ACTION_LENGTH = 128;
export const MAX_GENERATIVE_UI_PAYLOAD_BYTES = MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES;

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function hasValidResources(instanceId: string, action: string, payload: unknown): boolean {
  if (instanceId.length === 0 || instanceId.length > MAX_GENERATIVE_UI_INSTANCE_ID_LENGTH)
    return false;
  if (action.length === 0 || action.length > MAX_GENERATIVE_UI_ACTION_LENGTH) return false;
  try {
    if (!isJsonValue(payload, new Set())) return false;
    return getGenerativeUiActionPayloadBytes(payload) <= MAX_GENERATIVE_UI_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

export class GenerativeUiHandler implements DisposableHandler {
  constructor(private readonly context: GenerativeUiHandlerContext) {}

  dispose(): void {}

  async dispatch(msg: SessionInboundMessage): Promise<undefined> {
    switch (msg.type) {
      case "generative_ui.action.request":
      // COMPAT(generativeUiActionFlatRpc): added in v0.1.101; remove after 2027-01-11 once the client floor is >= v0.1.101.
      case "generative_ui.action":
        this.handleUiAction(msg);
        return undefined;
      default:
        return undefined;
    }
  }

  private handleUiAction(
    msg: Extract<
      SessionInboundMessage,
      { type: "generative_ui.action" | "generative_ui.action.request" }
    >,
  ): void {
    const { requestId, agentId, instanceId, action, payload, timestamp } = msg;
    const agent = this.context.agentManager.getAgent(agentId);
    if (!agent || (agent.lifecycle !== "running" && agent.lifecycle !== "idle")) {
      this.respond(requestId, false, "agent unavailable");
      return;
    }
    if (!hasValidResources(instanceId, action, payload)) {
      this.respond(requestId, false, "invalid generative UI action");
      return;
    }
    try {
      this.context.agentManager.enqueueGenerativeUiAction(agentId, {
        instanceId,
        action,
        payload,
        timestamp,
      });
      this.respond(requestId, true, null);
    } catch (error) {
      if (error instanceof GenerativeUiActionQueueFullError) {
        this.respond(requestId, false, "generative UI action queue is full");
        return;
      }
      throw error;
    }
  }

  private respond(requestId: string, received: boolean, error: string | null): void {
    this.context.emit(
      GenerativeUiActionResponseSchema.parse({
        type: "generative_ui.action.response",
        payload: { requestId, received, error },
      }),
    );
  }
}
