import type {
  ReadableStream as NodeReadableStream,
  WritableStream as NodeWritableStream,
} from "node:stream/web";
import type { AnyMessage, Stream as ACPStream } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

function summarizeMalformedACPStdoutError(error: unknown): { type: string; message: string } {
  return {
    type: error instanceof Error ? error.name : typeof error,
    message: "ACP stdout line was not valid JSON",
  };
}

function normalizeACPIncomingMessage(message: AnyMessage): AnyMessage {
  if (
    "id" in message &&
    !("method" in message) &&
    typeof message.id === "string" &&
    /^\d+$/.test(message.id)
  ) {
    const numericId = Number(message.id);
    if (Number.isSafeInteger(numericId)) {
      return {
        ...message,
        // COMPAT(deepseek-tui-acp-id): added v0.1.78, remove after 2026-11-19
        // once the ACP SDK accepts stringified numeric response IDs.
        id: numericId,
      } as AnyMessage;
    }
  }
  return message;
}

/**
 * Creates the logged newline-delimited JSON transport used by ACP connections.
 * @param output Writable byte stream connected to ACP stdin
 * @param input Readable byte stream connected to ACP stdout
 * @param options Logger and provider identity used for malformed-line diagnostics
 * @returns ACP SDK message stream
 */
export function createLoggedNdJsonStream(
  output: NodeWritableStream,
  input: NodeReadableStream,
  options: { logger: Logger; provider: string },
): ACPStream {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      let content = "";
      const reader = input.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }

          content += textDecoder.decode(value, { stream: true });
          const lines = content.split("\n");
          content = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
              continue;
            }

            try {
              const message: AnyMessage = JSON.parse(trimmedLine);
              controller.enqueue(normalizeACPIncomingMessage(message));
            } catch (error) {
              options.logger.warn(
                {
                  err: summarizeMalformedACPStdoutError(error),
                  provider: options.provider,
                },
                "ACP agent emitted non-JSON stdout; ignoring line",
              );
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(`${JSON.stringify(message)}\n`));
      } finally {
        writer.releaseLock();
      }
    },
  });

  return { readable, writable };
}
