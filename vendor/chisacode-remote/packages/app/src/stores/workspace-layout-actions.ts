import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
} from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

interface LegacyTabRecord {
  tabId: string;
  target: WorkspaceTabTarget;
}

function normalizeLegacyTab(value: unknown): LegacyTabRecord | null {
  const record = isPlainRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const target = normalizeWorkspaceTabTarget(
    isPlainRecord(record.target) ? (record.target as WorkspaceTabTarget) : null,
  );
  if (!target) {
    return null;
  }
  const tabId =
    trimNonEmpty(typeof record.tabId === "string" ? record.tabId : null) ??
    buildDeterministicWorkspaceTabId(target);
  return { tabId, target };
}

interface LegacyPaneRecord {
  id: string;
  tabs?: unknown;
  tabIds?: unknown;
  focusedTabId?: unknown;
}

function normalizeLegacyPane(value: unknown): LegacyPaneRecord | null {
  const record = isPlainRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const id = trimNonEmpty(typeof record.id === "string" ? record.id : null);
  return id ? { id, ...record } : null;
}

function collectLegacyPaneTabs(pane: LegacyPaneRecord): LegacyTabRecord[] {
  if (!Array.isArray(pane.tabs)) {
    return [];
  }
  const next: LegacyTabRecord[] = [];
  const seen = new Set<string>();
  for (const value of pane.tabs) {
    const tab = normalizeLegacyTab(value);
    if (!tab || seen.has(tab.tabId)) {
      continue;
    }
    seen.add(tab.tabId);
    next.push(tab);
  }
  return next;
}

function resolveLegacyFocusedTab(pane: LegacyPaneRecord): LegacyTabRecord | null {
  const tabs = collectLegacyPaneTabs(pane);
  if (tabs.length === 0) {
    return null;
  }
  const focusedTabId = trimNonEmpty(
    typeof pane.focusedTabId === "string" ? pane.focusedTabId : null,
  );
  if (focusedTabId) {
    const focused = tabs.find((tab) => tab.tabId === focusedTabId) ?? null;
    if (focused) {
      return focused;
    }
  }
  return tabs[tabs.length - 1] ?? null;
}

function collectLegacyPanes(node: unknown): LegacyPaneRecord[] {
  if (!isPlainRecord(node)) {
    return [];
  }
  if (node.kind === "pane") {
    const pane = normalizeLegacyPane(node.pane);
    return pane ? [pane] : [];
  }
  if (node.kind === "group" && isPlainRecord(node.group)) {
    const children = Array.isArray(node.group.children) ? node.group.children : [];
    return children.flatMap((child) => collectLegacyPanes(child));
  }
  return [];
}

function orderLegacyPanesByFocus(
  panes: LegacyPaneRecord[],
  focusedPaneId: string,
): LegacyPaneRecord[] {
  return [...panes].sort((left, right) => {
    const leftFocused = left.id === focusedPaneId ? -1 : 0;
    const rightFocused = right.id === focusedPaneId ? -1 : 0;
    return leftFocused - rightFocused;
  });
}

/**
 * Migrates a legacy split-pane workspace layout into the single active target.
 *
 * Legacy layouts stored a tree of panes, each with a tab list; the active
 * content is the focused tab of the focused pane (falling back to the first
 * pane and its last tab). Returns null when the layout has no usable tab.
 * @param raw Persisted legacy layout value
 * @returns The normalized active target, or null
 */
export function extractActiveTargetFromLegacyLayout(raw: unknown): WorkspaceTabTarget | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const root = raw.root;
  const panes = collectLegacyPanes(root);
  if (panes.length === 0) {
    return null;
  }

  const focusedPaneId = trimNonEmpty(
    typeof raw.focusedPaneId === "string" ? raw.focusedPaneId : null,
  );
  const orderedPanes = focusedPaneId ? orderLegacyPanesByFocus(panes, focusedPaneId) : panes;

  for (const pane of orderedPanes) {
    const tab = resolveLegacyFocusedTab(pane);
    if (tab) {
      return normalizeWorkspaceTabTarget(tab.target);
    }
  }
  return null;
}

/** Normalizes a persisted workspace key into a non-empty string, or null */
export function normalizeWorkspaceKey(value: unknown): string | null {
  return trimNonEmpty(typeof value === "string" ? value : null);
}
