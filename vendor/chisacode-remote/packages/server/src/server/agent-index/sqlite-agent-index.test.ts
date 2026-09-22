import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@chisacode/protocol/agent-labels";
import { AgentStorage, type StoredAgentRecord } from "../agent/agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { rebuildAgentIndexIfEmpty } from "./agent-index-rebuilder.js";
import { SqliteAgentIndex } from "./sqlite-agent-index.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (path: string) => {
  prepare(sql: string): { get(...args: unknown[]): unknown };
  close(): void;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function record(
  input: Partial<StoredAgentRecord> & Pick<StoredAgentRecord, "id">,
): StoredAgentRecord {
  return {
    id: input.id,
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    createdAt: input.createdAt ?? "2026-06-10T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-10T00:01:00.000Z",
    title: input.title ?? null,
    labels: input.labels ?? {},
    relation: input.relation,
    lastStatus: input.lastStatus ?? "idle",
    config: input.config ?? null,
    persistence: input.persistence ?? null,
    archivedAt: input.archivedAt,
  };
}

describe("SqliteAgentIndex", () => {
  test("rebuilds legacy records with parent labels as subagent relations", async () => {
    const dir = tempDir("agent-index-legacy-");
    const storage = new AgentStorage(join(dir, "agents"), createTestLogger());
    await storage.upsert(
      record({
        id: "child",
        labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
      }),
    );
    const dbPath = join(dir, "index", "agent-index.sqlite");
    const index = new SqliteAgentIndex(dbPath);

    await rebuildAgentIndexIfEmpty({ index, agentStorage: storage });
    index.close();

    const db = new Database(dbPath);
    const row = db.prepare("SELECT parent_agent_id, relation_kind FROM agent_relation").get() as {
      parent_agent_id: string;
      relation_kind: string;
    };
    db.close();

    expect(row).toEqual({ parent_agent_id: "parent", relation_kind: "subagent" });
  });

  test("upserts explicit relation and archive state through the storage hook", async () => {
    const dir = tempDir("agent-index-hook-");
    const storage = new AgentStorage(join(dir, "agents"), createTestLogger());
    const dbPath = join(dir, "index", "agent-index.sqlite");
    const index = new SqliteAgentIndex(dbPath);
    storage.setMutationHook(index);

    await storage.upsert(
      record({
        id: "child",
        relation: {
          kind: "handoff",
          parentAgentId: "parent",
          taskId: "task-1",
          source: "user",
        },
        archivedAt: "2026-06-10T00:02:00.000Z",
      }),
    );
    index.close();

    const db = new Database(dbPath);
    const row = db
      .prepare("SELECT relation_kind, parent_agent_id, archived_at FROM agent_index")
      .get() as {
      relation_kind: string;
      parent_agent_id: string;
      archived_at: string;
    };
    db.close();

    expect(row).toEqual({
      relation_kind: "handoff",
      parent_agent_id: "parent",
      archived_at: "2026-06-10T00:02:00.000Z",
    });
  });

  test("caps timeline search text rows", () => {
    const dir = tempDir("agent-index-timeline-");
    const dbPath = join(dir, "index", "agent-index.sqlite");
    const index = new SqliteAgentIndex(dbPath);
    index.upsertTimelineItems("agent-1", [
      {
        type: "assistant_message",
        text: "x".repeat(9_000),
      },
    ]);
    index.close();

    const db = new Database(dbPath);
    const row = db.prepare("SELECT length(text) AS length FROM agent_timeline_search").get() as {
      length: number;
    };
    db.close();

    expect(row.length).toBe(8_000);
  });
});
