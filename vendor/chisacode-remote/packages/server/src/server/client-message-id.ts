import { randomUUID } from "node:crypto";

export function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  if (typeof clientMessageId !== "string") {
    return undefined;
  }
  const trimmed = clientMessageId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveClientMessageId(
  clientMessageId: string | undefined,
  generateId: () => string = randomUUID,
): string {
  return normalizeClientMessageId(clientMessageId) ?? generateId();
}
