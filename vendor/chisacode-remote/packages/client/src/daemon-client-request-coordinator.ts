import {
  SessionInboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";

import type {
  DaemonCommandRequest,
  DaemonCommandResponseMessage,
  DaemonCommandResponsePayload,
  DaemonCommandResponseType,
} from "./daemon-client-command-transport.js";
import { DaemonRpcError } from "./daemon-client-rpc-error.js";

const DEFAULT_SEND_QUEUE_TIMEOUT_MS = 10_000;

interface Waiter<T> {
  predicate: (message: SessionOutboundMessage) => T | null;
  resolve(value: T): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface PendingSend {
  message: SessionInboundMessage;
  resolve(): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

type RpcWaitResult<T> = { kind: "ok"; value: T } | { kind: "error"; error: DaemonRpcError };

/** A cancellable daemon message waiter owned by the request coordinator. */
export interface DaemonWaitHandle<T> {
  promise: Promise<T>;
  cancel(error: Error): void;
}

interface RequestCoordinatorOptions {
  createRequestId(requestId?: string): string;
  getConnectionStatus(): "idle" | "connecting" | "connected" | "disconnected" | "disposed";
  sendConnectedMessage(message: SessionInboundMessage): void;
}

/** Owns correlated RPC waiters and requests queued during connection establishment. */
export class DaemonRequestCoordinator {
  private readonly waiters = new Set<Waiter<unknown>>();
  private pendingSends: PendingSend[] = [];

  constructor(private readonly options: RequestCoordinatorOptions) {}

  async request<T>(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout: number;
    select(message: SessionOutboundMessage): T | null;
    options?: { skipQueue?: boolean };
  }): Promise<T> {
    const { promise, cancel } = this.waitForWithCancel<RpcWaitResult<T>>(
      (message) => {
        if (message.type === "rpc_error" && message.payload.requestId === params.requestId) {
          return {
            kind: "error",
            error: new DaemonRpcError({
              requestId: message.payload.requestId,
              error: message.payload.error,
              requestType: message.payload.requestType,
              code: message.payload.code,
            }),
          };
        }
        const value = params.select(message);
        return value === null ? null : { kind: "ok", value };
      },
      params.timeout,
      params.options,
    );

    try {
      await this.sendOrQueue(params.message);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      cancel(resolvedError);
      void promise.catch(() => undefined);
      throw resolvedError;
    }

    const result = await promise;
    if (result.kind === "error") {
      throw result.error;
    }
    return result.value;
  }

  async requestCorrelated<
    TResponseType extends DaemonCommandResponseType,
    TResult = DaemonCommandResponsePayload<TResponseType>,
  >(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout: number;
    responseType: TResponseType;
    options?: { skipQueue?: boolean };
    selectPayload?: (payload: DaemonCommandResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    return this.request({
      requestId: params.requestId,
      message: params.message,
      timeout: params.timeout,
      options: params.options,
      select: (message) => {
        const correlated = message as DaemonCommandResponseMessage;
        if (correlated.type !== params.responseType) {
          return null;
        }
        const payload =
          correlated.payload as unknown as DaemonCommandResponsePayload<TResponseType>;
        if (payload.requestId !== params.requestId) {
          return null;
        }
        return params.selectPayload ? params.selectPayload(payload) : (payload as TResult);
      },
    });
  }

  requestSession<
    TResponseType extends DaemonCommandResponseType,
    TResult = DaemonCommandResponsePayload<TResponseType>,
  >(params: {
    requestId?: string;
    message: DaemonCommandRequest;
    responseType: TResponseType;
    timeout: number;
    selectPayload?: (payload: DaemonCommandResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    const requestId = this.options.createRequestId(params.requestId);
    const message = SessionInboundMessageSchema.parse({ ...params.message, requestId });
    return this.requestCorrelated({
      requestId,
      message,
      responseType: params.responseType,
      timeout: params.timeout,
      options: { skipQueue: true },
      ...(params.selectPayload ? { selectPayload: params.selectPayload } : {}),
    });
  }

  requestNamespaced<
    TResponseType extends DaemonCommandResponseType,
    TResult = DaemonCommandResponsePayload<TResponseType>,
  >(params: {
    requestId?: string;
    message: { type: Extract<SessionInboundMessage["type"], `${string}.request`> } & Record<
      string,
      unknown
    >;
    timeout: number;
    selectPayload?: (payload: DaemonCommandResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    const responseType = params.message.type.replace(/\.request$/, ".response") as TResponseType;
    return this.requestSession({ ...params, responseType });
  }

  waitForWithCancel<T>(
    predicate: (message: SessionOutboundMessage) => T | null,
    timeout = 30_000,
    _options?: { skipQueue?: boolean },
  ): DaemonWaitHandle<T> {
    const timeoutError = new Error(`Timeout waiting for message (${timeout}ms)`);
    let waiter: Waiter<T> | null = null;
    let settled = false;
    let rejectPromise: ((error: Error) => void) | null = null;

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedResolve = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      rejectPromise = wrappedReject;
      const timeoutHandle =
        timeout > 0
          ? setTimeout(() => {
              if (waiter) this.waiters.delete(waiter);
              wrappedReject(timeoutError);
            }, timeout)
          : null;
      waiter = { predicate, resolve: wrappedResolve, reject: wrappedReject, timeoutHandle };
      this.waiters.add(waiter);
    });

    return {
      promise,
      cancel: (error) => {
        if (settled) return;
        if (waiter) {
          this.waiters.delete(waiter);
          if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
        }
        if (rejectPromise) {
          rejectPromise(error);
          return;
        }
        queueMicrotask(() => {
          if (!settled && rejectPromise) rejectPromise(error);
        });
      },
    };
  }

  handleMessage(message: SessionOutboundMessage): void {
    for (const waiter of Array.from(this.waiters)) {
      const result = waiter.predicate(message);
      if (result === null) continue;
      this.waiters.delete(waiter);
      if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
      waiter.resolve(result);
    }
  }

  flushPendingSends(): void {
    const pendingSends = this.pendingSends;
    this.pendingSends = [];
    for (const pending of pendingSends) {
      clearTimeout(pending.timeoutHandle);
      try {
        if (this.options.getConnectionStatus() !== "connected") {
          pending.reject(new Error("Connection lost before message could be sent"));
          continue;
        }
        this.options.sendConnectedMessage(pending.message);
        pending.resolve();
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  clear(error: Error): void {
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
      waiter.reject(error);
    }
    this.waiters.clear();

    const pendingSends = this.pendingSends;
    this.pendingSends = [];
    for (const pending of pendingSends) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }

  private sendOrQueue(message: SessionInboundMessage): Promise<void> {
    const status = this.options.getConnectionStatus();
    if (status === "connected") {
      this.options.sendConnectedMessage(message);
      return Promise.resolve();
    }
    if (status !== "connecting") {
      return Promise.reject(new Error(`Transport not connected (status: ${status})`));
    }
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const index = this.pendingSends.findIndex((pending) => pending.resolve === resolve);
        if (index !== -1) this.pendingSends.splice(index, 1);
        reject(new Error("Timed out waiting for connection to send message"));
      }, DEFAULT_SEND_QUEUE_TIMEOUT_MS);
      this.pendingSends.push({ message, resolve, reject, timeoutHandle });
    });
  }
}
