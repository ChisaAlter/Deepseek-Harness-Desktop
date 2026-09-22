import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Logger } from "pino";
import { readAgentRelation } from "@chisacode/protocol/agent-labels";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { AGENT_INDEX_SCHEMA_SQL } from "./schema.js";

interface BetterSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
  };
  close(): void;
}

export interface AgentIndex {
  upsertAgent(record: StoredAgentRecord): void;
  upsertTimelineItems(agentId: string, items: AgentTimelineItem[]): void;
  markDeleted(agentId: string): void;
  isEmpty(): boolean;
  close(): void;
}

const TIMELINE_SEARCH_TEXT_CAP = 8_000;

export class SqliteAgentIndex implements AgentIndex {
  private readonly db: BetterSqliteDatabase;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const Database = requireBetterSqlite3();
    this.db = new Database(dbPath) as BetterSqliteDatabase;
    this.db.exec(AGENT_INDEX_SCHEMA_SQL);
  }

  isEmpty(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM agent_index").get() as
      | { count?: number }
      | undefined;
    return (row?.count ?? 0) === 0;
  }

  upsertAgent(record: StoredAgentRecord): void {
    const relation = readAgentRelation(record.labels, record.relation);
    this.db
      .prepare(
        `INSERT INTO agent_index (
          agent_id, provider, cwd, title, last_status, relation_kind, parent_agent_id, archived_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          provider=excluded.provider,
          cwd=excluded.cwd,
          title=excluded.title,
          last_status=excluded.last_status,
          relation_kind=excluded.relation_kind,
          parent_agent_id=excluded.parent_agent_id,
          archived_at=excluded.archived_at,
          updated_at=excluded.updated_at`,
      )
      .run(
        record.id,
        record.provider,
        record.cwd,
        record.title ?? null,
        record.lastStatus,
        relation?.kind ?? null,
        relation?.parentAgentId ?? null,
        record.archivedAt ?? null,
        record.updatedAt,
      );

    this.db
      .prepare(
        `INSERT INTO agent_relation (
          agent_id, parent_agent_id, relation_kind, task_id, source
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          parent_agent_id=excluded.parent_agent_id,
          relation_kind=excluded.relation_kind,
          task_id=excluded.task_id,
          source=excluded.source`,
      )
      .run(
        record.id,
        relation?.parentAgentId ?? null,
        relation?.kind ?? null,
        relation?.taskId ?? null,
        relation?.source ?? null,
      );
  }

  upsertTimelineItems(agentId: string, items: AgentTimelineItem[]): void {
    this.db.prepare("DELETE FROM agent_timeline_search WHERE agent_id = ?").run(agentId);
    const insert = this.db.prepare(
      `INSERT INTO agent_timeline_search (agent_id, seq, kind, text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const createdAt = new Date().toISOString();
    items.forEach((item, index) => {
      const text = extractTimelineSearchText(item);
      if (!text) {
        return;
      }
      insert.run(agentId, index + 1, item.type, capTimelineSearchText(text), createdAt);
    });
  }

  markDeleted(agentId: string): void {
    this.db
      .prepare(
        `UPDATE agent_index
         SET archived_at = COALESCE(archived_at, ?), updated_at = ?
         WHERE agent_id = ?`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), agentId);
  }

  close(): void {
    this.db.close();
  }
}

export function createSqliteAgentIndex(dbPath: string, logger: Logger): AgentIndex | null {
  try {
    return new SqliteAgentIndex(dbPath);
  } catch (error) {
    logger.warn({ err: error, dbPath }, "Agent SQLite index disabled");
    return null;
  }
}

function requireBetterSqlite3(): new (dbPath: string) => BetterSqliteDatabase {
  // Optional dependency: keep daemon startup alive if native binding cannot load.
  const require = createRequire(import.meta.url);
  return require("better-sqlite3") as new (dbPath: string) => BetterSqliteDatabase;
}

function extractTimelineSearchText(item: AgentTimelineItem): string | null {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return item.text;
    case "error":
      return item.message;
    case "turn_changes":
      return item.changeSummary;
    case "tool_call":
      return extractToolCallSearchText(item);
    default:
      return null;
  }
}

function extractToolCallSearchText(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
): string {
  const detail = item.detail;
  switch (detail.type) {
    case "shell":
      return [detail.command, detail.output].filter(Boolean).join("\n");
    case "read":
      return [detail.filePath, detail.content].filter(Boolean).join("\n");
    case "edit":
      return [detail.filePath, detail.unifiedDiff].filter(Boolean).join("\n");
    case "write":
      return [detail.filePath, detail.content].filter(Boolean).join("\n");
    case "search":
      return [detail.query, detail.content].filter(Boolean).join("\n");
    case "fetch":
      return [detail.url, detail.result].filter(Boolean).join("\n");
    case "sub_agent":
      return [detail.description, detail.log].filter(Boolean).join("\n");
    case "plain_text":
      return [detail.label, detail.text].filter(Boolean).join("\n");
    case "plan":
      return detail.text;
    case "unknown":
      return "";
    case "worktree_setup":
      return detail.log;
  }
}

function capTimelineSearchText(text: string): string {
  return text.length > TIMELINE_SEARCH_TEXT_CAP ? text.slice(0, TIMELINE_SEARCH_TEXT_CAP) : text;
}
