import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import { withTimeout } from "../../../../utils/promise-timeout.js";
import { OPENCODE_PENDING_ABORT_START_TIMEOUT_MS } from "./constants.js";

interface OpenCodeAbortCoordinatorOptions {
  client: OpencodeClient;
  sessionId: string;
  getDirectory: () => string;
  logger: Logger;
}

/** Owns local turn cancellation and serialized OpenCode session.abort state. */
export class OpenCodeAbortCoordinator {
  private activeTurnController: AbortController | null = null;
  private pendingAbortPromise: Promise<void> | null = null;

  constructor(private readonly options: OpenCodeAbortCoordinatorOptions) {}

  beginTurn(): AbortController {
    const controller = new AbortController();
    this.activeTurnController = controller;
    return controller;
  }

  clearTurn(controller?: AbortController): void {
    if (!controller || this.activeTurnController === controller) {
      this.activeTurnController = null;
    }
  }

  async interruptCurrentTurn(turnId: string | null): Promise<void> {
    this.activeTurnController?.abort();
    const abortPromise = this.beginSessionAbort(turnId, "interrupt");
    await withTimeout(abortPromise, 2_000, "OpenCode session.abort").catch((error) => {
      this.options.logger.warn(
        { err: error, sessionId: this.options.sessionId, turnId },
        "OpenCode session.abort exceeded the cancel cap; proceeding with local cancel",
      );
    });
  }

  async awaitPendingBeforeStart(): Promise<void> {
    const pendingAbortPromise = this.pendingAbortPromise;
    if (!pendingAbortPromise) {
      return;
    }
    await withTimeout(
      pendingAbortPromise,
      OPENCODE_PENDING_ABORT_START_TIMEOUT_MS,
      "OpenCode pending session.abort",
    ).catch((error) => {
      this.options.logger.warn(
        { err: error, sessionId: this.options.sessionId },
        "OpenCode session.abort was still pending before starting the next turn",
      );
    });
  }

  close(): void {
    this.activeTurnController?.abort();
    this.activeTurnController = null;
  }

  private beginSessionAbort(turnId: string | null, reason: string): Promise<void> {
    const abortPromise = this.options.client.session
      .abort({
        sessionID: this.options.sessionId,
        directory: this.options.getDirectory(),
      })
      .then(() => undefined)
      .catch((error) => {
        this.options.logger.warn(
          { err: error, sessionId: this.options.sessionId, turnId, reason },
          "OpenCode session.abort rejected",
        );
      });
    const trackedAbortPromise = abortPromise.finally(() => {
      if (this.pendingAbortPromise === trackedAbortPromise) {
        this.pendingAbortPromise = null;
      }
    });
    this.pendingAbortPromise = trackedAbortPromise;
    return trackedAbortPromise;
  }
}
