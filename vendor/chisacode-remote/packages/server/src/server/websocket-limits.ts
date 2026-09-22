import { MAX_FILE_TRANSFER_BYTES } from "@chisacode/protocol/binary-frames/file-transfer";

/** Maximum plaintext payload accepted by every direct or relay session transport. */
export const WEBSOCKET_MAX_PAYLOAD_BYTES = MAX_FILE_TRANSFER_BYTES;

/**
 * Returns whether a decoded logical WebSocket payload is within the shared transport limit.
 * @param payloadBytes Decoded payload byte length
 * @returns Whether the payload may enter the session dispatcher
 */
export function isWebSocketPayloadWithinLimit(payloadBytes: number): boolean {
  return (
    Number.isSafeInteger(payloadBytes) &&
    payloadBytes >= 0 &&
    payloadBytes <= WEBSOCKET_MAX_PAYLOAD_BYTES
  );
}
