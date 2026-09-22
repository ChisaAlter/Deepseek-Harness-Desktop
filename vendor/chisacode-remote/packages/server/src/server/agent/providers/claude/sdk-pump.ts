import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

interface ClaudeSdkPumpTraceContext {
  agentId?: string;
  provider?: string;
  sessionId?: string | null;
  turnId?: string;
}

interface ClaudeSdkPumpOptions {
  logger: Logger;
  getTraceContext: () => ClaudeSdkPumpTraceContext;
  isClosed: () => boolean;
  ensureQuery: () => Promise<Query>;
  isCurrentQuery: (query: Query) => boolean;
  handleMissingResumedConversation: (message: SDKMessage, query: Query) => Promise<boolean>;
  routeMessage: (message: SDKMessage) => void;
  failActiveTurns: (errorMessage: string) => void;
  awaitRecentStderrAfterProcessExit: (error: unknown) => Promise<void>;
  clearQueryIfCurrent: (query: Query) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Claude stream failed";
}

function shouldRecoverInterruptedQueryAbort(
  error: unknown,
  consecutiveRecoveries: number,
): boolean {
  if (consecutiveRecoveries >= 3) {
    return false;
  }
  let message: string;
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = `${error.message}\n${error.stack ?? ""}`;
  } else {
    message = JSON.stringify(error);
  }
  return message.toLowerCase().includes("request was aborted");
}

/** Runs the Claude SDK async iterator with bounded interrupt-abort recovery. */
export async function runClaudeSdkQueryPump(options: ClaudeSdkPumpOptions): Promise<void> {
  let activeQuery: Query;
  try {
    activeQuery = await options.ensureQuery();
  } catch (error) {
    options.logger.trace(
      { ...options.getTraceContext(), err: error },
      "provider.claude.query_pump.init_failed",
    );
    options.failActiveTurns(errorMessage(error));
    return;
  }

  let consecutiveInterruptAbortRecoveries = 0;
  const logRawMessage = (message: SDKMessage): void => {
    options.logger.trace(
      {
        ...options.getTraceContext(),
        messageType: message.type,
        messageSubtype: "subtype" in message ? message.subtype : undefined,
        messageUuid: "uuid" in message ? message.uuid : undefined,
        rawEvent: message,
      },
      "provider.claude.raw_event",
    );
  };
  const handlePumpedMessage = async (message: SDKMessage): Promise<boolean> => {
    logRawMessage(message);
    consecutiveInterruptAbortRecoveries = 0;
    if (await options.handleMissingResumedConversation(message, activeQuery)) {
      return true;
    }
    options.routeMessage(message);
    return false;
  };
  const drainActiveQuery = async (): Promise<boolean> => {
    for await (const message of activeQuery) {
      if (await handlePumpedMessage(message)) {
        return true;
      }
    }
    return false;
  };

  try {
    while (!options.isClosed() && options.isCurrentQuery(activeQuery)) {
      try {
        if (await drainActiveQuery()) {
          return;
        }
        if (!options.isClosed() && options.isCurrentQuery(activeQuery)) {
          options.failActiveTurns("Claude stream ended before terminal result");
        }
        return;
      } catch (error) {
        if (
          !options.isClosed() &&
          options.isCurrentQuery(activeQuery) &&
          shouldRecoverInterruptedQueryAbort(error, consecutiveInterruptAbortRecoveries)
        ) {
          consecutiveInterruptAbortRecoveries += 1;
          options.logger.debug(
            { recoveries: consecutiveInterruptAbortRecoveries },
            "Recovering Claude query pump after interrupt abort",
          );
          continue;
        }
        if (!options.isClosed() && options.isCurrentQuery(activeQuery)) {
          await options.awaitRecentStderrAfterProcessExit(error);
          options.failActiveTurns(errorMessage(error));
        }
        return;
      }
    }
  } finally {
    options.clearQueryIfCurrent(activeQuery);
  }
}
