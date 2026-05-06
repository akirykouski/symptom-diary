-- Hypothesis Engine learning loop:
--   * hypothesis_feedback records every user reaction (dismiss / confirm /
--     reactivate) along with the score AT THE MOMENT OF the action, so the
--     "must grow ≥ 30% to resurface" rule can compare apples to apples.
--   * entry_corroboration tracks user-marked "doctor agreed" links between
--     a journal entry and an active hypothesis, surfaced in the brief.

CREATE TABLE hypothesis_feedback (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypothesis(id) ON DELETE CASCADE,
  disease_id TEXT NOT NULL REFERENCES disease_profile(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                   -- dismissed | confirmed | reactivated
  reason TEXT,
  recorded_at TEXT NOT NULL,
  match_score_at_action REAL NOT NULL
);
CREATE INDEX idx_feedback_disease ON hypothesis_feedback(disease_id);
CREATE INDEX idx_feedback_recorded ON hypothesis_feedback(recorded_at);

CREATE TABLE entry_corroboration (
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL REFERENCES hypothesis(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, hypothesis_id)
);
CREATE INDEX idx_corroboration_hypothesis ON entry_corroboration(hypothesis_id);
