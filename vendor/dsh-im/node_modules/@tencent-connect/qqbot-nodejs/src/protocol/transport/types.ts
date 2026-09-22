/**
 * EventTransport — abstract interface for receiving QQ Bot events.
 *
 * The SDK supports multiple transport mechanisms for receiving events
 * from the QQ Open Platform:
 *
 *   - **WebSocket** (default): long-lived connection with heartbeat, RESUME, etc.
 *   - **Webhook** (HTTP callback): QQ POSTs events to your HTTPS endpoint.
 *
 * Both transports deliver events through the same callback interface,
 * so the middleware chain and event listeners work identically regardless
 * of transport choice.
 */

import type { InboundMessage } from "../gateway/event-dispatcher.js";
import type { InteractionEvent, Logger } from "../types.js";

// ============ Callback interface ============

/** Callbacks invoked by any transport when events arrive. */
export interface EventTransportCallbacks {
  onReady?: (data: unknown) => void;
  onResumed?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onMessage: (msg: InboundMessage) => void | Promise<void>;
  onInteraction?: (event: InteractionEvent) => void | Promise<void>;
}

// ============ Transport interface ============

/**
 * An event transport that can start/stop receiving events.
 *
 * Implementations:
 * - `WebSocketTransport` — wraps GatewayConnection
 * - `WebhookTransport` — HTTP server receiving POST callbacks
 */
export interface EventTransport {
  /** Start receiving events. Resolves when the transport is stopped. */
  start(): Promise<void>;
  /** Stop receiving events and clean up resources. */
  stop(): void;
}

// ============ Transport factory options ============

export interface WebSocketTransportOptions {
  /** Account info. */
  account: { accountId: string; appId: string; clientSecret: string };
  /** Abort signal for graceful shutdown. */
  abortSignal: AbortSignal;
  /** Logger. */
  log?: Logger;
  /** User-Agent. */
  userAgent?: string;
  /** Intent mask. */
  intents?: number;
  /** Token fetcher. */
  getAccessToken: () => Promise<string>;
  /** Clear cached token. */
  clearTokenCache?: () => void;
  /** Get gateway WS URL. */
  getGatewayUrl: (token: string) => Promise<string>;
  /** Session persistence. */
  session?: import("../gateway/gateway-connection.js").SessionPersistencePort;
}

export interface WebhookTransportOptions {
  /** Bot AppID. */
  appId: string;
  /** Bot AppSecret (used for Ed25519 signature verification). */
  appSecret: string;
  /** Port to listen on. Defaults to 8080. */
  port?: number;
  /** Path to listen on. Defaults to "/". */
  path?: string;
  /** Account ID for logging. */
  accountId?: string;
  /** Logger. */
  log?: Logger;
  /** Abort signal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /**
   * Bring your own HTTP server adapter (Express/Fastify/Koa/etc).
   * If not provided, SDK uses built-in node:http server.
   */
  server?: WebhookServerAdapter;
}

// ============ Webhook server adapter ============

/** Incoming HTTP request shape (framework-agnostic). */
export interface WebhookRequest {
  /** Raw request body as Buffer. */
  body: Buffer;
  /** Request headers (lowercase keys). */
  headers: Record<string, string | string[] | undefined>;
}

/** Response shape that the webhook handler returns. */
export interface WebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

/** Handler function type for webhook. */
export type WebhookRequestHandler = (req: WebhookRequest) => Promise<WebhookResponse>;

/**
 * Adapter interface for plugging in any HTTP server framework.
 *
 * If you use Express/Fastify/Koa, implement this interface and pass it
 * as `webhook.server`. Otherwise the SDK uses a built-in `node:http` server.
 */
export interface WebhookServerAdapter {
  /** Start listening and route requests to handler. */
  listen(port: number, path: string, handler: WebhookRequestHandler): Promise<void>;
  /** Stop the server. */
  close(): void;
}
