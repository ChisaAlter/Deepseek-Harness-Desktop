import { randomUUID } from "node:crypto";

export const COMPANION_MCP_SERVER_NAME = "chisacode-companion";
export const COMPANION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export interface CompanionMcpTokenEntry {
  parentAgentId: string;
  expiresAt: number;
}

export function createCompanionTokenEntry(parentAgentId: string): {
  token: string;
  entry: CompanionMcpTokenEntry;
} {
  return {
    token: randomUUID(),
    entry: {
      parentAgentId,
      expiresAt: Date.now() + COMPANION_TOKEN_TTL_MS,
    },
  };
}

export function buildCompanionMcpUrl(input: {
  mcpBaseUrl: string;
  parentAgentId: string;
  token: string;
}): string {
  const url = new URL(input.mcpBaseUrl);
  url.searchParams.set("callerAgentId", input.parentAgentId);
  url.searchParams.set("parentAgentId", input.parentAgentId);
  url.searchParams.set("companionToken", input.token);
  return url.toString();
}
