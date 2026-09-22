export const AGENT_INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_index (
  agent_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cwd TEXT NOT NULL,
  title TEXT,
  last_status TEXT NOT NULL,
  relation_kind TEXT,
  parent_agent_id TEXT,
  archived_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_relation (
  agent_id TEXT PRIMARY KEY,
  parent_agent_id TEXT,
  relation_kind TEXT,
  task_id TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS agent_timeline_search (
  agent_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, seq)
);
`;
