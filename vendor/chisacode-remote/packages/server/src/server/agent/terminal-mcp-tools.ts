import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import type { TerminalManager } from "../../terminal/terminal-manager.js";
import type { TerminalSession } from "../../terminal/terminal.js";
import { ensureValidJson } from "../json-utils.js";
import { isSameOrDescendantPath } from "../path-utils.js";

const TerminalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
});

/** Dependencies and caller-scope policy for terminal MCP tools. */
export interface RegisterTerminalMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  terminalManager?: TerminalManager | null;
  resolveScopedCwd(requestedCwd?: string, options?: { required?: boolean }): string;
  resolveScopeRoot(): string | null;
}

/** Registers terminal discovery and control tools with caller-workspace isolation. */
export function registerTerminalMcpTools(options: RegisterTerminalMcpToolsOptions): void {
  const requireManager = (): TerminalManager => {
    if (!options.terminalManager) {
      throw new Error("Terminal manager is not configured");
    }
    return options.terminalManager;
  };

  const isCwdInScope = (cwd: string): boolean => {
    const scopeRoot = options.resolveScopeRoot();
    return !scopeRoot || isSameOrDescendantPath(scopeRoot, cwd);
  };

  const assertTerminalInScope = (terminal: TerminalSession): void => {
    if (!isCwdInScope(terminal.cwd)) {
      throw new Error(`Terminal ${terminal.id} is outside the caller workspace scope`);
    }
  };

  const requireTerminal = (terminalId: string): TerminalSession => {
    const terminal = requireManager().getTerminal(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }
    assertTerminalInScope(terminal);
    return terminal;
  };

  options.registerTool(
    "list_terminals",
    {
      title: "List terminals",
      description: "List terminals for a working directory or across all permitted directories.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to the caller agent cwd."),
        all: z.boolean().optional().describe("List terminals across all permitted directories."),
      },
      outputSchema: {
        terminals: z.array(TerminalSummarySchema),
      },
    },
    async ({ cwd, all }) => {
      const terminalManager = requireManager();
      const terminals = all
        ? (
            await Promise.all(
              terminalManager
                .listDirectories()
                .filter(isCwdInScope)
                .map((directory) => terminalManager.getTerminals(directory)),
            )
          )
            .flat()
            .filter((terminal) => isCwdInScope(terminal.cwd))
        : await terminalManager.getTerminals(options.resolveScopedCwd(cwd, { required: true }));

      return {
        content: [],
        structuredContent: ensureValidJson({ terminals: terminals.map(toTerminalSummary) }),
      };
    },
  );

  options.registerTool(
    "create_terminal",
    {
      title: "Create terminal",
      description: "Create a terminal session for a permitted working directory.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to the caller agent cwd."),
        name: z.string().optional().describe("Optional terminal name."),
      },
      outputSchema: TerminalSummarySchema.shape,
    },
    async ({ cwd, name }) => {
      const terminal = await requireManager().createTerminal({
        cwd: options.resolveScopedCwd(cwd, { required: true }),
        ...(name?.trim() ? { name: name.trim() } : {}),
      });
      assertTerminalInScope(terminal);
      return {
        content: [],
        structuredContent: ensureValidJson(toTerminalSummary(terminal)),
      };
    },
  );

  options.registerTool(
    "kill_terminal",
    {
      title: "Kill terminal",
      description: "Kill an existing terminal session within the caller workspace scope.",
      inputSchema: {
        terminalId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId }) => {
      requireTerminal(terminalId).kill();
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  options.registerTool(
    "capture_terminal",
    {
      title: "Capture terminal",
      description: "Capture plain-text terminal output lines within the caller workspace scope.",
      inputSchema: {
        terminalId: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        scrollback: z.boolean().optional(),
        stripAnsi: z.boolean().optional().default(true),
      },
      outputSchema: {
        terminalId: z.string(),
        lines: z.array(z.string()),
        totalLines: z.number().int().nonnegative(),
      },
    },
    async ({ terminalId, start, end, scrollback, stripAnsi = true }) => {
      requireTerminal(terminalId);
      const capture = await requireManager().captureTerminal(terminalId, {
        start: scrollback ? 0 : start,
        end,
        stripAnsi,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          terminalId,
          lines: capture.lines,
          totalLines: capture.totalLines,
        }),
      };
    },
  );

  options.registerTool(
    "send_terminal_keys",
    {
      title: "Send terminal keys",
      description: "Send literal text or special key tokens within the caller workspace scope.",
      inputSchema: {
        terminalId: z.string(),
        keys: z.string(),
        literal: z.boolean().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId, keys, literal = false }) => {
      const terminal = requireTerminal(terminalId);
      terminal.send({
        type: "input",
        data: resolveTerminalKeyToken(keys, literal),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );
}

function toTerminalSummary(terminal: Pick<TerminalSession, "id" | "name" | "cwd">): {
  id: string;
  name: string;
  cwd: string;
} {
  return {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.cwd,
  };
}

function resolveTerminalKeyToken(key: string, literal: boolean): string {
  if (literal) {
    return key;
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "Space":
      return " ";
    case "BSpace":
      return "\u007f";
    case "C-c":
      return "\u0003";
    case "C-d":
      return "\u0004";
    case "C-z":
      return "\u001a";
    case "C-l":
      return "\u000c";
    case "C-a":
      return "\u0001";
    case "C-e":
      return "\u0005";
    default:
      return key;
  }
}
