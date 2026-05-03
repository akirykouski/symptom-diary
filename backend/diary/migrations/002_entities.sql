CREATE TABLE entity (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_entity_type ON entity(type);

CREATE VIRTUAL TABLE entity_vec USING vec0(
  entity_id TEXT PRIMARY KEY,
  embedding float[768]
);

CREATE TABLE entity_mention (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  span_start INTEGER,
  span_end INTEGER,
  confidence REAL,
  attrs TEXT
);
CREATE INDEX idx_mention_entry ON entity_mention(entry_id);
CREATE INDEX idx_mention_entity ON entity_mention(entity_id);

CREATE TABLE edge (
  id TEXT PRIMARY KEY,
  src_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  dst_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  weight REAL NOT NULL,
  evidence_count INTEGER NOT NULL,
  last_observed_at TEXT,
  UNIQUE(src_entity_id, dst_entity_id, kind)
);
CREATE INDEX idx_edge_src ON edge(src_entity_id);
CREATE INDEX idx_edge_dst ON edge(dst_entity_id);

CREATE TABLE extraction_job (
  entry_id TEXT PRIMARY KEY REFERENCES entry(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_job_status ON extraction_job(status);
