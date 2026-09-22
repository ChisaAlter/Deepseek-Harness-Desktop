import type { Logger } from "pino";

import type {
  AgentManagerEvent,
  AgentSubscriber,
  ManagedAgent,
  SubscribeOptions,
} from "./agent-manager.js";

interface AgentManagerEventBusOptions {
  logger: Logger;
  validateAgentId(agentId: string, source: string): string;
  getAgent(agentId: string): ManagedAgent | null;
  listAgents(): Iterable<ManagedAgent>;
}

interface SubscriptionRecord {
  callback: AgentSubscriber;
  agentId: string | null;
}

function getEventAgentId(event: AgentManagerEvent): string {
  return event.type === "agent_stream" ? event.agentId : event.agent.id;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** Owns AgentManager subscriber registration, replay, visibility filtering, and isolation. */
export class AgentManagerEventBus {
  private readonly subscribers = new Set<SubscriptionRecord>();
  private readonly options: AgentManagerEventBusOptions;

  constructor(options: AgentManagerEventBusOptions) {
    this.options = options;
  }

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    const targetAgentId =
      options?.agentId == null ? null : this.options.validateAgentId(options.agentId, "subscribe");
    const record: SubscriptionRecord = { callback, agentId: targetAgentId };
    this.subscribers.add(record);

    if (options?.replayState !== false) {
      this.replayState(record);
    }

    return () => {
      this.subscribers.delete(record);
    };
  }

  dispatch(event: AgentManagerEvent): void {
    for (const subscriber of this.subscribers) {
      if (!this.shouldDeliver(subscriber, event)) {
        continue;
      }
      this.deliver(subscriber.callback, event);
    }
  }

  private replayState(subscriber: SubscriptionRecord): void {
    if (subscriber.agentId) {
      const agent = this.options.getAgent(subscriber.agentId);
      if (agent) {
        this.deliver(subscriber.callback, { type: "agent_state", agent: { ...agent } });
      }
      return;
    }

    for (const agent of this.options.listAgents()) {
      if (!agent.internal) {
        this.deliver(subscriber.callback, { type: "agent_state", agent: { ...agent } });
      }
    }
  }

  private shouldDeliver(subscriber: SubscriptionRecord, event: AgentManagerEvent): boolean {
    const eventAgentId = getEventAgentId(event);
    if (subscriber.agentId) {
      return subscriber.agentId === eventAgentId;
    }

    if (event.type === "agent_state") {
      return !event.agent.internal;
    }
    return !this.options.getAgent(eventAgentId)?.internal;
  }

  private deliver(callback: AgentSubscriber, event: AgentManagerEvent): void {
    try {
      const result = (callback as (input: AgentManagerEvent) => unknown)(event);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error: unknown) => {
          this.logSubscriberError(error, event);
        });
      }
    } catch (error) {
      this.logSubscriberError(error, event);
    }
  }

  private logSubscriberError(error: unknown, event: AgentManagerEvent): void {
    this.options.logger.warn(
      { err: error, eventType: event.type, agentId: getEventAgentId(event) },
      "Agent subscriber failed",
    );
  }
}
