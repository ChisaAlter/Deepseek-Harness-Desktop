import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type pino from "pino";

interface SessionMcpClientControllerOptions {
  mcpBaseUrl: string | null;
  sessionLogger: pino.Logger;
  createClient?: typeof createMCPClient;
}

/** Owns asynchronous creation and teardown of one session-scoped daemon MCP client. */
export class SessionMcpClientController {
  private readonly createClient: typeof createMCPClient;
  private client: MCPClient | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: SessionMcpClientControllerOptions) {
    this.createClient = options.createClient ?? createMCPClient;
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!this.options.mcpBaseUrl) {
      this.options.sessionLogger.info(
        "Skipping Agent MCP initialization because no MCP base URL is configured",
      );
      return;
    }

    const generation = ++this.generation;
    let client: MCPClient | null = null;
    try {
      client = await this.createClient({
        transport: { type: "http", url: this.options.mcpBaseUrl },
      });
      if (this.disposed || generation !== this.generation) {
        await closeClient(client, this.options.sessionLogger, "late Agent MCP client");
        return;
      }

      this.client = client;
      const agentTools = await client.tools();
      if (this.disposed || generation !== this.generation) {
        if (this.client === client) {
          this.client = null;
        }
        await closeClient(client, this.options.sessionLogger, "late Agent MCP client");
        return;
      }
      this.options.sessionLogger.trace(
        { agentToolCount: Object.keys(agentTools).length },
        "agent.session.mcp_init",
      );
    } catch (error) {
      if (client) {
        if (this.client === client) {
          this.client = null;
        }
        await closeClient(client, this.options.sessionLogger, "failed Agent MCP client");
      }
      if (!this.disposed && generation === this.generation) {
        this.options.sessionLogger.error({ err: error }, "Failed to initialize Agent MCP");
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.generation += 1;
    const client = this.client;
    this.client = null;
    if (client) {
      await closeClient(client, this.options.sessionLogger, "Agent MCP client");
    }
  }
}

async function closeClient(client: MCPClient, logger: pino.Logger, label: string): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    logger.error({ err: error }, `Failed to close ${label}`);
  }
}
