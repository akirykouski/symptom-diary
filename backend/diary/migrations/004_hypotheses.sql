-- Curated rare + common disease profiles + sliced features for hypothesis matching.
CREATE TABLE disease_profile (
  id TEXT PRIMARY KEY,           -- e.g. "ORPHA:84964" or "seed:lupus_sle"
  source TEXT NOT NULL,          -- "orphanet" | "medlineplus" | "omim" | "seed"
  name TEXT NOT NULL,
  synonyms TEXT NOT NULL,        -- JSON array
  prevalence_class TEXT,
  inheritance TEXT,
  age_of_onset TEXT,
  description_md TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT,                 -- coarse grouping for UI: autoimmune|metabolic|genetic|neuro|gi|other
  red_flag INTEGER NOT NULL DEFAULT 0,  -- if 1, surface earlier (often emergent / time-sensitive)
  last_synced_at TEXT NOT NULL
);
CREATE INDEX idx_disease_source ON disease_profile(source);
CREATE INDEX idx_disease_category ON disease_profile(category);

CREATE TABLE disease_feature (
  id TEXT PRIMARY KEY,
  disease_id TEXT NOT NULL REFERENCES disease_profile(id) ON DELETE CASCADE,
  feature_name TEXT NOT NULL,
  feature_kind TEXT NOT NULL,    -- symptom|sign|lab_pattern|imaging|temporal
  frequency_class TEXT NOT NULL, -- obligate|very_frequent|frequent|occasional
  hpo_id TEXT,
  embedding BLOB
);
CREATE INDEX idx_feature_disease ON disease_feature(disease_id);
CREATE INDEX idx_feature_kind ON disease_feature(feature_kind);

CREATE VIRTUAL TABLE disease_feature_vec USING vec0(
  feature_id TEXT PRIMARY KEY,
  embedding float[768]
);

CREATE TABLE hypothesis (
  id TEXT PRIMARY KEY,
  disease_id TEXT NOT NULL REFERENCES disease_profile(id) ON DELETE CASCADE,
  match_score REAL NOT NULL,
  signal_strength TEXT NOT NULL, -- weak|moderate|strong
  rationale_md TEXT NOT NULL,
  cited_entry_ids TEXT NOT NULL, -- JSON array
  cited_lab_value_ids TEXT,      -- JSON array
  cited_medication_ids TEXT,     -- JSON array
  matched_features TEXT,         -- JSON [{feature_id, similarity, frequency_class}]
  suggested_actions_md TEXT,
  status TEXT NOT NULL,          -- active|dismissed|expired|confirmed
  generated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_note TEXT,
  dismissed_reason TEXT
);
CREATE INDEX idx_hypothesis_status ON hypothesis(status);
CREATE INDEX idx_hypothesis_disease ON hypothesis(disease_id);
CREATE INDEX idx_hypothesis_signal ON hypothesis(signal_strength);
