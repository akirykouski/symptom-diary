-- Feedback round 3 (issue #3): the Hypothesis Engine effectively matched only
-- on labs because formal feature names ("oral ulcers", "polyarthritis") rarely
-- pass the embedding-similarity floor against colloquial diary phrasing
-- ("sores in mouth", "stiff joints"). We now carry an explicit list of patient-
-- language aliases per feature and score user signals against the max of
-- feature-name similarity and any alias similarity.
CREATE TABLE disease_feature_alias (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL REFERENCES disease_feature(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX idx_alias_feature ON disease_feature_alias(feature_id);
