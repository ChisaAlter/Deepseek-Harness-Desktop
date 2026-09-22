import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

import type { McpServerConfig } from "../../agent-sdk-types.js";
import { readOpenCodeRecord } from "./event-values.js";
import {
  isAlreadyPresentMcpError,
  toOpenCodeMcpConfig,
  type OpenCodeMcpConfig,
} from "./helpers.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";

interface OpenCodeMcpControllerOptions {
  client: Pick<OpencodeClient, "mcp">;
  getDirectory: () => string;
}

function readOpenCodeMcpOperationError(data: unknown, name: string): unknown {
  const root = readOpenCodeRecord(data);
  const entry = readOpenCodeRecord(root?.[name]);
  if (!entry || entry.status !== "failed") {
    return undefined;
  }
  return entry.error ?? `OpenCode reported MCP server '${name}' failed`;
}

/** Owns one-time OpenCode MCP registration, concurrent setup, and retry state. */
export class OpenCodeMcpController {
  private configured = false;
  private setupPromise: Promise<void> | null = null;

  constructor(private readonly options: OpenCodeMcpControllerOptions) {}

  async ensureConfigured(mcpServers: Record<string, McpServerConfig> | undefined): Promise<void> {
    if (this.configured) {
      return;
    }
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
      this.configured = true;
      return;
    }
    this.setupPromise ??= this.configure(mcpServers);
    try {
      await this.setupPromise;
      this.configured = true;
    } catch (error) {
      this.setupPromise = null;
      throw error;
    }
  }

  private async configure(mcpServers: Record<string, McpServerConfig>): Promise<void> {
    await Promise.all(
      Object.entries(mcpServers).map(([name, config]) =>
        this.register(name, toOpenCodeMcpConfig(config)),
      ),
    );
  }

  private async register(name: string, config: OpenCodeMcpConfig): Promise<void> {
    const response = await this.options.client.mcp.add({
      directory: this.options.getDirectory(),
      name,
      config,
    });
    const error = response.error ?? readOpenCodeMcpOperationError(response.data, name);
    if (!error || isAlreadyPresentMcpError(error)) {
      return;
    }
    throw new Error(
      `Failed to add OpenCode MCP server '${name}': ${toDiagnosticErrorMessage(error)}`,
    );
  }
}
