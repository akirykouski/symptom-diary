CREATE TABLE media (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- image | audio | document
  storage_path TEXT NOT NULL,    -- relative path under media_dir(); file is encrypted
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  description TEXT,              -- vision: caption / extracted text
  transcript TEXT,               -- whisper: spoken text
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|failed
  last_error TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_media_entry ON media(entry_id);
CREATE INDEX idx_media_status ON media(status);

CREATE TABLE document_record (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,        -- visit_note|lab_result|prescription|imaging|discharge|referral|other
  doc_date TEXT,                 -- ISO8601 date if visible in the document
  clinician_name TEXT,
  clinician_specialty TEXT,
  facility TEXT,
  language_detected TEXT,
  findings_md TEXT,
  recommendations_md TEXT,
  raw_extracted_json TEXT NOT NULL,
  user_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_doc_record_media ON document_record(media_id);
CREATE INDEX idx_doc_record_date ON document_record(doc_date);
CREATE INDEX idx_doc_record_type ON document_record(doc_type);

CREATE TABLE lab_value (
  id TEXT PRIMARY KEY,
  document_record_id TEXT NOT NULL REFERENCES document_record(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  test_name_raw TEXT NOT NULL,
  value_numeric REAL,
  value_text TEXT,
  unit TEXT,
  reference_low REAL,
  reference_high REAL,
  is_abnormal INTEGER,
  measured_at TEXT,
  notes TEXT
);
CREATE INDEX idx_lab_doc ON lab_value(document_record_id);
CREATE INDEX idx_lab_test_time ON lab_value(test_name, measured_at);

CREATE TABLE medication_record (
  id TEXT PRIMARY KEY,
  document_record_id TEXT NOT NULL REFERENCES document_record(id) ON DELETE CASCADE,
  drug_name TEXT NOT NULL,
  drug_name_raw TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  duration TEXT,
  prescribed_at TEXT,
  notes TEXT
);
CREATE INDEX idx_med_doc ON medication_record(document_record_id);
CREATE INDEX idx_med_drug ON medication_record(drug_name);
