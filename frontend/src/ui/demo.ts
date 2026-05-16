/* Clario demo dataset — synthetic patient "Maria L." from the design handoff
   (data.js). Used as a graceful fallback so every reskinned screen still
   reads well when the local encrypted DB has no real data yet. Real data
   from the API always takes precedence; demo data only fills the gap.

   `pick(real, demo)` returns the real list when it has content, otherwise
   the demo list together with a flag the screens use to show a small
   "sample data" marker so nothing is ever silently faked. */

export function pick<R, D>(
  real: R[] | undefined | null,
  demo: D[],
): { rows: R[] | D[]; isDemo: boolean } {
  if (real && real.length > 0) return { rows: real, isDemo: false };
  return { rows: demo, isDemo: true };
}

export interface DemoTag {
  id: string;
  name: string;
  color: string;
}
export interface DemoEntry {
  id: string;
  ts: string;
  mood: number;
  severity: number;
  tags: string[];
  text: string;
  entities: string[];
}
export interface DemoDoc {
  id: string;
  type: string;
  title: string;
  date: string;
  clinician: string;
  specialty: string;
  facility: string;
  findings?: string;
  recommendations?: string;
  verified: boolean;
  hasMedia: boolean;
}
export interface DemoLab {
  id: string;
  test: string;
  value: number;
  unit: string;
  ref: string;
  flag: "low" | "high" | "normal";
  date: string;
  docId: string;
}
export interface DemoMed {
  id: string;
  drug: string;
  dose: string;
  frequency: string;
  duration: string;
  prescribed: string;
  docId: string;
}
export interface DemoFeature {
  signal: string;
  feature: string;
  freq: string;
  sim: number;
}
export interface DemoHypothesis {
  id: string;
  disease: string;
  category: string;
  signal: "strong" | "moderate" | "weak";
  score: number;
  redFlag: boolean;
  userConfirmed: boolean;
  rationale: string;
  citedEntries: string[];
  citedLabs: string[];
  citedMeds: string[];
  suggested: string;
  features: DemoFeature[];
}

export const DEMO = {
  user: { name: "Maria L.", initials: "ML" },

  tags: [
    { id: "t1", name: "headache", color: "oklch(60% 0.13 30)" },
    { id: "t2", name: "fatigue", color: "oklch(60% 0.10 280)" },
    { id: "t3", name: "joints", color: "oklch(64% 0.12 80)" },
    { id: "t4", name: "sleep", color: "oklch(58% 0.10 250)" },
    { id: "t5", name: "rash", color: "oklch(60% 0.12 0)" },
    { id: "t6", name: "meds", color: "oklch(58% 0.08 215)" },
  ] as DemoTag[],

  entries: [
    { id: "e1", ts: "2026-05-15T08:30", mood: -1, severity: 6, tags: ["t1", "t2"], text: "Woke up with a dull headache around the temples again, third morning this week. Skull feels heavy. Drank water, no improvement after 45 min.", entities: ["headache (temple)", "morning", "hydration"] },
    { id: "e2", ts: "2026-05-14T19:10", mood: 0, severity: 4, tags: ["t3"], text: "Right knee stiff after sitting at the desk all afternoon. Loosened up after a walk. No swelling visible.", entities: ["knee stiffness", "prolonged sitting", "walking"] },
    { id: "e3", ts: "2026-05-14T07:20", mood: -2, severity: 7, tags: ["t2", "t4"], text: "Slept 9 hours but woke up exhausted. Felt like I never went to bed. Same pattern as last Monday.", entities: ["unrefreshing sleep", "fatigue"] },
    { id: "e4", ts: "2026-05-13T15:45", mood: 0, severity: 5, tags: ["t5", "t3"], text: "Faint pink rash across the bridge of the nose and cheeks after lunch outside. Faded by evening. Knees ached at the same time.", entities: ["malar rash", "sun exposure", "joint pain"] },
    { id: "e5", ts: "2026-05-12T11:00", mood: 1, severity: 2, tags: [], text: "Good morning. Light headache resolved with coffee. Tried 20 min walk before work.", entities: ["mild headache", "caffeine", "exercise"] },
    { id: "e6", ts: "2026-05-11T22:30", mood: -1, severity: 6, tags: ["t1", "t4"], text: "Can't fall asleep — third night in a row. Mind racing about the lab results we're waiting on.", entities: ["insomnia", "anxiety", "onset evening"] },
    { id: "e7", ts: "2026-05-10T09:15", mood: 0, severity: 4, tags: ["t3", "t6"], text: "Took ibuprofen 400 mg before going to the playground with Leo. Knees held up.", entities: ["ibuprofen 400mg", "joint pain", "prophylactic"] },
    { id: "e8", ts: "2026-05-09T18:00", mood: -1, severity: 5, tags: ["t2"], text: "Hit the wall around 4 pm. Couldn't finish the report. Lay down for an hour.", entities: ["afternoon fatigue", "reduced productivity"] },
  ] as DemoEntry[],

  documents: [
    { id: "d1", type: "visit_note", title: "Rheumatology consult", date: "2026-04-22", clinician: "Dr. Petra Kovač, MD", specialty: "Rheumatology", facility: "Riga General", findings: "Patient reports 6 months of intermittent malar rash with sun exposure, polyarthralgia (PIP, knees), and unrefreshing sleep. No active synovitis on exam.", recommendations: "Order ANA panel + complement levels. Consider photoprotection. Re-evaluate in 6 weeks.", verified: true, hasMedia: true },
    { id: "d2", type: "lab_result", title: "CBC + ANA panel", date: "2026-04-25", clinician: "LabPlus Diagnostics", specialty: "—", facility: "LabPlus", verified: true, hasMedia: true },
    { id: "d3", type: "prescription", title: "Ferrous sulfate 65 mg", date: "2026-04-25", clinician: "Dr. Petra Kovač, MD", specialty: "Rheumatology", facility: "Riga General", verified: true, hasMedia: true },
    { id: "d4", type: "imaging", title: "Knee X-ray (R)", date: "2026-03-12", clinician: "Dr. Sandis Bērziņš", specialty: "Radiology", facility: "Riga General", verified: false, hasMedia: true },
    { id: "d5", type: "visit_note", title: "GP follow-up", date: "2026-02-08", clinician: "Dr. Anna Liepiņa", specialty: "Family medicine", facility: "Clinic Mežaparks", verified: true, hasMedia: false },
  ] as DemoDoc[],

  labValues: [
    { id: "l1", test: "Hemoglobin", value: 11.2, unit: "g/dL", ref: "12.0–15.5", flag: "low", date: "2026-04-25", docId: "d2" },
    { id: "l2", test: "Ferritin", value: 8, unit: "ng/mL", ref: "13–150", flag: "low", date: "2026-04-25", docId: "d2" },
    { id: "l3", test: "MCV", value: 78, unit: "fL", ref: "80–100", flag: "low", date: "2026-04-25", docId: "d2" },
    { id: "l4", test: "ANA titer", value: 1 / 320, unit: "titer", ref: "< 1/80", flag: "high", date: "2026-04-25", docId: "d2" },
    { id: "l5", test: "C3 complement", value: 78, unit: "mg/dL", ref: "90–180", flag: "low", date: "2026-04-25", docId: "d2" },
    { id: "l6", test: "C4 complement", value: 13, unit: "mg/dL", ref: "10–40", flag: "normal", date: "2026-04-25", docId: "d2" },
    { id: "l7", test: "TSH", value: 2.4, unit: "mIU/L", ref: "0.4–4.0", flag: "normal", date: "2026-04-25", docId: "d2" },
    { id: "l8", test: "Ferritin", value: 14, unit: "ng/mL", ref: "13–150", flag: "normal", date: "2025-11-12", docId: "d5" },
    { id: "l9", test: "Ferritin", value: 11, unit: "ng/mL", ref: "13–150", flag: "low", date: "2026-02-08", docId: "d5" },
    { id: "l10", test: "Hemoglobin", value: 12.1, unit: "g/dL", ref: "12.0–15.5", flag: "normal", date: "2025-11-12", docId: "d5" },
    { id: "l11", test: "Hemoglobin", value: 11.6, unit: "g/dL", ref: "12.0–15.5", flag: "low", date: "2026-02-08", docId: "d5" },
  ] as DemoLab[],

  medications: [
    { id: "m1", drug: "Ferrous sulfate", dose: "65 mg", frequency: "1× daily AM", duration: "90 days", prescribed: "2026-04-25", docId: "d3" },
    { id: "m2", drug: "Ibuprofen", dose: "400 mg", frequency: "as needed", duration: "PRN", prescribed: "2026-04-22", docId: "d1" },
    { id: "m3", drug: "Vitamin D3", dose: "2000 IU", frequency: "1× daily", duration: "ongoing", prescribed: "2026-02-08", docId: "d5" },
  ] as DemoMed[],

  hypotheses: [
    {
      id: "h1", disease: "Iron-deficiency anemia", category: "Hematology",
      signal: "strong", score: 0.82, redFlag: false, userConfirmed: false,
      rationale: "Ferritin 8 ng/mL (low), MCV 78 fL (microcytic), and hemoglobin 11.2 g/dL (low) form a textbook microcytic picture. Patient also reports persistent fatigue and unrefreshing sleep across 4+ recent entries, consistent with iron-deficiency symptomatology. Trend: ferritin declined from 14 → 11 → 8 ng/mL over six months.",
      citedEntries: ["e3", "e8", "e2"], citedLabs: ["l1", "l2", "l3", "l8", "l9"], citedMeds: ["m1"],
      suggested: "Discuss with your clinician whether to investigate source of iron loss and to confirm response on a repeat CBC + ferritin in 8–12 weeks.",
      features: [
        { signal: "fatigue mention", feature: "fatigue (frequent)", freq: "very_frequent", sim: 0.91 },
        { signal: "ferritin 8 ng/mL", feature: "low ferritin", freq: "obligate", sim: 0.96 },
        { signal: "MCV 78 fL", feature: "microcytic anemia", freq: "frequent", sim: 0.88 },
        { signal: "unrefreshing sleep", feature: "sleep disturbance", freq: "frequent", sim: 0.72 },
      ],
    },
    {
      id: "h2", disease: "Systemic lupus erythematosus (SLE)", category: "Rheumatology",
      signal: "moderate", score: 0.61, redFlag: false, userConfirmed: false,
      rationale: "Malar rash with photosensitivity (entry from 2026-05-13), polyarthralgia (knees and PIP joints), ANA 1:320, and low C3 form a constellation worth discussing with rheumatology. C4 is in range. Symptoms episodic, not progressive — engine output is intentionally hedged.",
      citedEntries: ["e4", "e2", "e7"], citedLabs: ["l4", "l5"], citedMeds: [],
      suggested: "Bring the cited entries and the ANA + complement values to your rheumatologist. Repeat ANA and complement in 6–8 weeks if symptoms persist.",
      features: [
        { signal: "malar rash + sun", feature: "photosensitive rash", freq: "frequent", sim: 0.84 },
        { signal: "polyarthralgia", feature: "non-erosive arthritis", freq: "very_frequent", sim: 0.79 },
        { signal: "ANA 1:320", feature: "ANA positive", freq: "obligate", sim: 0.95 },
        { signal: "C3 78 mg/dL", feature: "low complement", freq: "frequent", sim: 0.71 },
      ],
    },
    {
      id: "h3", disease: "Tension-type headache", category: "Neurology",
      signal: "weak", score: 0.34, redFlag: false, userConfirmed: false,
      rationale: "Recurrent bilateral pressure-type morning headaches with no aura, photophobia, or vomiting noted in entries. Consistent with tension-type pattern but the signal is weak — fatigue and sleep entries could equally explain the picture.",
      citedEntries: ["e1", "e5", "e6"], citedLabs: [], citedMeds: ["m2"],
      suggested: "Track triggers (sleep, caffeine, screen time) in future entries to refine the pattern.",
      features: [
        { signal: "bilateral temple", feature: "bilateral pressure HA", freq: "frequent", sim: 0.66 },
        { signal: "morning onset", feature: "morning headache", freq: "frequent", sim: 0.58 },
      ],
    },
  ] as DemoHypothesis[],

  briefStats: { entries: 8, documents: 5, abnormal_labs: 4, medications: 3, hypotheses: 3 },

  appointment: {
    title: "Rheumatology follow-up",
    clinician: "Dr. Petra Kovač",
    facility: "Riga General",
    date: "2026-05-22T10:30",
    daysUntil: 6,
    prepReady: true,
  },
};
