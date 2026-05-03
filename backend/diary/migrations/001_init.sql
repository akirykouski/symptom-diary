CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  ts_recorded TEXT NOT NULL,
  ts_event TEXT NOT NULL,
  text_md TEXT NOT NULL,
  mood INTEGER,
  severity INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_entry_ts_event ON entry(ts_event);

CREATE TABLE tag (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE entry_tag (
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
