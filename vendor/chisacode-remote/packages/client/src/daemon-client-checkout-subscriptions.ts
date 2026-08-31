import {
  SessionInboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";

import { safeRandomId } from "./daemon-client-transport-utils.js";

type CheckoutStatusPayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_status_response" }
>["payload"];
type SubscribeCheckoutDiffPayload = Extract<
  SessionOutboundMessage,
  { type: "subscribe_checkout_diff_response" }
>["payload"];
type CheckoutDiffPayload = Omit<SubscribeCheckoutDiffPayload, "subscriptionId">;

export interface CheckoutDiffCompare {
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
}

interface CheckoutSubscriptionTransport {
  createRequestId(requestId?: string): string;
  sendRequest<T>(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout: number;
    select: (message: SessionOutboundMessage) => T | null;
    options?: { skipQueue?: boolean };
  }): Promise<T>;
  sendMessage(message: SessionInboundMessage): void;
}

interface CheckoutDiffSubscription {
  cwd: string;
  compare: CheckoutDiffCompare;
}

/** Owns checkout status deduplication and diff subscription reconnect state. */
export class CheckoutSubscriptionClient {
  private readonly statusInFlight = new Map<string, Promise<CheckoutStatusPayload>>();
  private readonly diffSubscriptions = new Map<string, CheckoutDiffSubscription>();

  constructor(private readonly transport: CheckoutSubscriptionTransport) {}

  getStatus(cwd: string, options?: { requestId?: string }): Promise<CheckoutStatusPayload> {
    const requestId = options?.requestId;
    if (!requestId) {
      const existing = this.statusInFlight.get(cwd);
      if (existing) {
        return existing;
      }
    }

    const resolvedRequestId = this.transport.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "checkout_status_request",
      cwd,
      requestId: resolvedRequestId,
    });
    const responsePromise = this.transport.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: 60000,
      options: { skipQueue: true },
      select: (response) => {
        if (response.type !== "checkout_status_response") {
          return null;
        }
        if (response.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return response.payload;
      },
    });

    if (!requestId) {
      this.statusInFlight.set(cwd, responsePromise);
      void responsePromise
        .finally(() => {
          if (this.statusInFlight.get(cwd) === responsePromise) {
            this.statusInFlight.delete(cwd);
          }
        })
        .catch(() => undefined);
    }
    return responsePromise;
  }

  async getDiff(
    cwd: string,
    compare: CheckoutDiffCompare,
    requestId?: string,
  ): Promise<CheckoutDiffPayload> {
    const subscriptionId = `oneshot-checkout-diff:${safeRandomId()}`;
    try {
      const payload = await this.subscribe(cwd, compare, { subscriptionId, requestId });
      return {
        cwd: payload.cwd,
        files: payload.files,
        error: payload.error,
        requestId: payload.requestId,
      };
    } finally {
      try {
        this.unsubscribe(subscriptionId);
      } catch {
        // Ignore disconnect races during one-shot cleanup.
      }
    }
  }

  async subscribe(
    cwd: string,
    compare: CheckoutDiffCompare,
    options?: { subscriptionId?: string; requestId?: string },
  ): Promise<SubscribeCheckoutDiffPayload> {
    const subscriptionId = options?.subscriptionId ?? safeRandomId();
    const normalizedCompare = normalizeCheckoutDiffCompare(compare);
    const previousSubscription = this.diffSubscriptions.get(subscriptionId) ?? null;
    this.diffSubscriptions.set(subscriptionId, { cwd, compare: normalizedCompare });

    const resolvedRequestId = this.transport.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "subscribe_checkout_diff_request",
      subscriptionId,
      cwd,
      compare: normalizedCompare,
      requestId: resolvedRequestId,
    });

    try {
      return await this.transport.sendRequest({
        requestId: resolvedRequestId,
        message,
        timeout: 60000,
        options: { skipQueue: true },
        select: (response) => {
          if (response.type !== "subscribe_checkout_diff_response") {
            return null;
          }
          if (response.payload.requestId !== resolvedRequestId) {
            return null;
          }
          if (response.payload.subscriptionId !== subscriptionId) {
            return null;
          }
          return response.payload;
        },
      });
    } catch (error) {
      if (previousSubscription) {
        this.diffSubscriptions.set(subscriptionId, previousSubscription);
      } else {
        this.diffSubscriptions.delete(subscriptionId);
      }
      throw error;
    }
  }

  unsubscribe(subscriptionId: string): void {
    this.diffSubscriptions.delete(subscriptionId);
    this.transport.sendMessage({
      type: "unsubscribe_checkout_diff_request",
      subscriptionId,
    });
  }

  resubscribe(): void {
    for (const [subscriptionId, subscription] of this.diffSubscriptions) {
      const message = SessionInboundMessageSchema.parse({
        type: "subscribe_checkout_diff_request",
        subscriptionId,
        cwd: subscription.cwd,
        compare: subscription.compare,
        requestId: this.transport.createRequestId(),
      });
      this.transport.sendMessage(message);
    }
  }
}

function normalizeCheckoutDiffCompare(compare: CheckoutDiffCompare): CheckoutDiffCompare {
  if (compare.mode === "uncommitted") {
    return compare.ignoreWhitespace === true
      ? { mode: "uncommitted", ignoreWhitespace: true }
      : { mode: "uncommitted" };
  }
  const trimmedBaseRef = compare.baseRef?.trim();
  if (!trimmedBaseRef) {
    return compare.ignoreWhitespace === true
      ? { mode: "base", ignoreWhitespace: true }
      : { mode: "base" };
  }
  return compare.ignoreWhitespace === true
    ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace: true }
    : { mode: "base", baseRef: trimmedBaseRef };
}
