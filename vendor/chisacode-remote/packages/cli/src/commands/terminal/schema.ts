import type { OutputSchema } from "../../output/index.js";

export interface TerminalRow {
  id: string;
  name: string;
  cwd: string;
}

export interface TerminalKillRow {
  terminalId: string;
  success: boolean;
}

export const terminalSchema: OutputSchema<TerminalRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: (row) => row.id.slice(0, 8), width: 8 },
    { header: "NAME", field: "name", width: 24 },
    { header: "CWD", field: "cwd", width: 48 },
  ],
};

export const terminalKillSchema: OutputSchema<TerminalKillRow> = {
  idField: "terminalId",
  columns: [
    { header: "ID", field: (row) => row.terminalId.slice(0, 8), width: 8 },
    { header: "SUCCESS", field: "success", width: 8 },
  ],
};

export function toTerminalRow(
  terminal: {
    id: string;
    name: string;
    cwd?: string;
  },
  cwd?: string,
): TerminalRow {
  return {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.cwd ?? cwd ?? "-",
  };
}
