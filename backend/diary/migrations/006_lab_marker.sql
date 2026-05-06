-- Issue 8 (clinician brief feedback): the LLM-driven entity classifier was
-- emitting lab tests / biomarkers (ANA, C3, C4, anti-dsDNA, hemoglobin,
-- ferritin, TSH, …) under type='med'. The new `lab_marker` type belongs in
-- entities; this migration retypes existing rows so the brief's symptom
-- filter doesn't pick up labs and the medications section doesn't get
-- polluted with antibody-test names.
--
-- The list mirrors KNOWN_LAB_MARKERS in extraction.py. Keep in sync.

UPDATE entity SET type = 'lab_marker', updated_at = (datetime('now'))
WHERE type IN ('med', 'symptom', 'other')
  AND lower(canonical_name) IN (
    -- Autoimmune / complement
    'ana','ena','anti-dsdna','anti-sm','anti-rnp','anti-ro','anti-la',
    'anti-ccp','ccp','rheumatoid factor','rf','complement','c3','c4',
    'immunoglobulin','igg','iga','igm','ige',
    -- Inflammation
    'crp','c-reactive protein','esr','sed rate',
    -- Hematology
    'hemoglobin','hgb','hb','hematocrit','hct','wbc','white blood cell count',
    'rbc','red blood cell count','platelets','plt','mcv','mch','mchc','rdw',
    'neutrophils','lymphocytes','monocytes','eosinophils',
    -- Iron
    'ferritin','iron','transferrin','tibc',
    -- Liver
    'alt','ast','alp','ggt','bilirubin','albumin','total protein',
    -- Kidney
    'creatinine','urea','bun','egfr','gfr',
    -- Electrolytes
    'sodium','potassium','chloride','calcium','magnesium','phosphate',
    'bicarbonate',
    -- Endocrine / metabolism
    'glucose','hba1c','a1c','insulin','tsh','t3','t4','free t3','free t4',
    'ft3','ft4',
    -- Lipids
    'cholesterol','hdl','ldl','triglycerides',
    -- Vitamins
    'b12','folate','vitamin d','25-oh-d','25 hydroxyvitamin d',
    -- Coagulation
    'pt','inr','ptt','aptt','fibrinogen',
    -- Cardiac
    'troponin','bnp','nt-probnp',
    -- Other
    'ldh','lipase','amylase','ck','ck-mb',
    -- Tumor markers
    'psa','ca-125','cea','afp'
  );
