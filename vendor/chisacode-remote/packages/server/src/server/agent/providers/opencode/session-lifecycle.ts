import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import { isOpenCodeNotFoundError } from "./helpers.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";

interface OpenCodeSessionLifecycleOptions {
  client: Pick<OpencodeClient, "session">;
  sessionId: string;
  getDirectory: () => string;
  logger: Logger;
  persistSession: boolean;
  releaseServer?: () => void;
  closeEventBus: () => void;
  closeAbortCoordinator: () => void;
  closeEventStream: () => void;
}

export async function reconcileOpenCodeSessionClose(params: {
  client: Pick<OpencodeClient, "session">;
  sessionId: string;
  directory: string;
  logger: Logger;
}): Promise<void> {
  const { client, sessionId, directory, logger } = params;
  try {
    const response = await client.session.abort({ sessionID: sessionId, directory });
    if (response.error && !isOpenCodeNotFoundError(response.error)) {
      logger.warn(
        { sessionId, error: toDiagnosticErrorMessage(response.error) },
        "Failed to abort OpenCode session during close",
      );
    }
  } catch (error) {
    logger.warn(
      { sessionId, error: toDiagnosticErrorMessage(error) },
      "Failed to abort OpenCode session during close",
    );
  }

  try {
    const response = await client.session.update({
      sessionID: sessionId,
      directory,
      time: { archived: Date.now() },
    });
    if (response.error && !isOpenCodeNotFoundError(response.error)) {
      logger.warn(
        { sessionId, error: toDiagnosticErrorMessage(response.error) },
        "Failed to archive OpenCode session during close",
      );
    }
  } catch (error) {
    logger.warn(
      { sessionId, error: toDiagnosticErrorMessage(error) },
      "Failed to archive OpenCode session during close",
    );
  }
}

/** Owns OpenCode session shutdown ordering, provider cleanup, and server release. */
export class OpenCodeSessionLifecycle {
  private deletedFromProvider = false;
  private releaseServer: (() => void) | null;

  constructor(private readonly options: OpenCodeSessionLifecycleOptions) {
    this.releaseServer = options.releaseServer ?? null;
  }

  async close(): Promise<void> {
    try {
      this.options.closeEventBus();
      this.options.closeAbortCoordinator();
      this.options.closeEventStream();
      await reconcileOpenCodeSessionClose({
        client: this.options.client,
        sessionId: this.options.sessionId,
        directory: this.options.getDirectory(),
        logger: this.options.logger,
      });
      await this.deleteProviderSessionIfEphemeral();
    } finally {
      this.releaseServer?.();
      this.releaseServer = null;
    }
  }

  private async deleteProviderSessionIfEphemeral(): Promise<void> {
    if (this.options.persistSession || this.deletedFromProvider) {
      return;
    }
    this.deletedFromProvider = true;
    try {
      const response = await this.options.client.session.delete({
        sessionID: this.options.sessionId,
        directory: this.options.getDirectory(),
      });
      if (response.error) {
        throw new Error(`OpenCode session.delete failed: ${JSON.stringify(response.error)}`);
      }
    } catch (error) {
      this.options.logger.debug(
        { err: error, sessionId: this.options.sessionId },
        "Failed to delete non-persistent OpenCode session",
      );
    }
  }
}
