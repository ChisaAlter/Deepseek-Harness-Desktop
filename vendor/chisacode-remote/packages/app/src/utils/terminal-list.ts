import type { CreateTerminalResponse, ListTerminalsResponse } from "@chisacode/protocol/messages";

type TerminalListEntry = ListTerminalsResponse["payload"]["terminals"][number];
type CreatedTerminal = NonNullable<CreateTerminalResponse["payload"]["terminal"]>;

function toTerminalListEntry(input: { terminal: CreatedTerminal }): TerminalListEntry {
  return {
    id: input.terminal.id,
    name: input.terminal.name,
    ...(input.terminal.title ? { title: input.terminal.title } : {}),
  };
}

/**
 * Inserts or replaces a terminal list entry after create/update
 * @param input Existing terminals list and the created terminal payload
 * @returns New terminals array with the entry upserted by id
 */
export function upsertTerminalListEntry(input: {
  terminals: TerminalListEntry[];
  terminal: CreatedTerminal;
}): TerminalListEntry[] {
  const createdTerminal = toTerminalListEntry({ terminal: input.terminal });
  const existingIndex = input.terminals.findIndex((terminal) => terminal.id === createdTerminal.id);

  if (existingIndex < 0) {
    return [...input.terminals, createdTerminal];
  }

  const nextTerminals = [...input.terminals];
  nextTerminals[existingIndex] = createdTerminal;
  return nextTerminals;
}
