/**
 * Thin fetch wrapper. Uses cookie-based auth (FastAPI sets session cookie).
 * In dev the Vite proxy forwards /api → :8765, so we rely on relative URLs.
 */

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const r = await fetch(path, init);
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const data = text ? safeJson(text) : null;
  if (!r.ok) {
    throw new ApiError(r.status, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface Entry {
  id: string;
  ts_recorded: string;
  ts_event: string;
  text_md: string;
  mood: number | null;
  severity: number | null;
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface EntryInput {
  ts_event: string;
  text_md: string;
  mood?: number | null;
  severity?: number | null;
  tag_ids?: string[];
}

export interface AuthStatus {
  setup: boolean;
  unlocked: boolean;
}

export const api = {
  // auth
  status: () => request<AuthStatus>("GET", "/api/auth/status"),
  setup: (passphrase: string) =>
    request<AuthStatus>("POST", "/api/auth/setup", { passphrase }),
  unlock: (passphrase: string) =>
    request<AuthStatus>("POST", "/api/auth/unlock", { passphrase }),
  lock: () => request<void>("POST", "/api/auth/lock"),

  // entries
  listEntries: (params?: { from?: string; to?: string; tag?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.tag) q.set("tag", params.tag);
    const suffix = q.toString();
    return request<Entry[]>(
      "GET",
      suffix ? `/api/entries?${suffix}` : "/api/entries",
    );
  },
  getEntry: (id: string) => request<Entry>("GET", `/api/entries/${id}`),
  createEntry: (body: EntryInput) =>
    request<Entry>("POST", "/api/entries", body),
  updateEntry: (id: string, body: Partial<EntryInput>) =>
    request<Entry>("PATCH", `/api/entries/${id}`, body),
  deleteEntry: (id: string) =>
    request<void>("DELETE", `/api/entries/${id}`),

  // tags
  listTags: () => request<Tag[]>("GET", "/api/tags"),
  createTag: (body: { name: string; color?: string | null }) =>
    request<Tag>("POST", "/api/tags", body),
  deleteTag: (id: string) => request<void>("DELETE", `/api/tags/${id}`),

  // llm
  llmStatus: () => request<LlmStatus>("GET", "/api/llm/status"),

  // entities + graph
  listEntities: (params?: { type?: string; q?: string }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.q) q.set("q", params.q);
    const suffix = q.toString();
    return request<EntitySummary[]>(
      "GET",
      suffix ? `/api/entities?${suffix}` : "/api/entities",
    );
  },
  getEntity: (id: string) => request<EntityDetail>("GET", `/api/entities/${id}`),
  patchEntity: (id: string, body: { canonical_name?: string; type?: string }) =>
    request<EntityDetail>("PATCH", `/api/entities/${id}`, body),
  mergeEntity: (srcId: string, targetId: string) =>
    request<EntityDetail>("POST", `/api/entities/${srcId}/merge`, {
      target_id: targetId,
    }),
  deleteEntity: (id: string) => request<void>("DELETE", `/api/entities/${id}`),
  getGraph: (params?: { focus?: string; depth?: number; types?: string }) => {
    const q = new URLSearchParams();
    if (params?.focus) q.set("focus", params.focus);
    if (params?.depth) q.set("depth", String(params.depth));
    if (params?.types) q.set("types", params.types);
    const suffix = q.toString();
    return request<Graph>("GET", suffix ? `/api/graph?${suffix}` : "/api/graph");
  },

  // extraction
  reextractEntry: (id: string) =>
    request<{ status: string }>("POST", `/api/entries/${id}/reextract`),
  queueStatus: () =>
    request<QueueStatus>("GET", "/api/entries/queue/status"),
  entryEntities: (id: string) =>
    request<EntryEntity[]>("GET", `/api/entries/${id}/entities`),

  // media
  listEntryMedia: (entryId: string) =>
    request<Media[]>("GET", `/api/entries/${entryId}/media`),
  uploadMedia: async (entryId: string, file: File, kind: MediaKind) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const r = await fetch(`/api/entries/${entryId}/media`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!r.ok) {
      throw new ApiError(r.status, await r.text());
    }
    return (await r.json()) as Media;
  },
  deleteMedia: (id: string) => request<void>("DELETE", `/api/media/${id}`),
  reprocessMedia: (id: string) =>
    request<{ status: string }>("POST", `/api/media/${id}/reprocess`),
  mediaUrl: (id: string) => `/api/media/${id}`,
  mediaThumbUrl: (id: string) => `/api/media/${id}/thumbnail`,

  // documents
  listDocuments: (params?: { from?: string; to?: string; type?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.type) q.set("type", params.type);
    const suffix = q.toString();
    return request<DocumentRecord[]>(
      "GET",
      suffix ? `/api/documents?${suffix}` : "/api/documents",
    );
  },
  getDocument: (id: string) => request<DocumentRecord>("GET", `/api/documents/${id}`),
  patchDocument: (id: string, body: Partial<DocumentRecord>) =>
    request<DocumentRecord>("PATCH", `/api/documents/${id}`, body),

  // labs
  labsTests: () =>
    request<{ test_name: string; count: number }[]>("GET", "/api/labs/tests"),
  labsTimeline: (test: string, params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams({ test });
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    return request<LabSeries>("GET", `/api/labs/timeline?${q.toString()}`);
  },

  // medications
  medicationsTimeline: () =>
    request<MedicationRecord[]>("GET", "/api/medications/timeline"),

  // hypotheses
  listHypotheses: (status: "active" | "all" | "dismissed" | "confirmed" | "expired" = "active") =>
    request<Hypothesis[]>("GET", `/api/hypotheses?status=${status}`),
  getHypothesis: (id: string) => request<Hypothesis>("GET", `/api/hypotheses/${id}`),
  patchHypothesis: (
    id: string,
    body: { status?: string; user_note?: string; dismissed_reason?: string },
  ) => request<Hypothesis>("PATCH", `/api/hypotheses/${id}`, body),
  recheckHypotheses: () =>
    request<{ candidates_considered: number; hypotheses_written: number; user_signals: number }>(
      "POST",
      "/api/hypotheses/recheck",
    ),
  kbStatus: () =>
    request<{
      disease_count: number;
      feature_count: number;
      embedded_feature_count: number;
      last_synced_at: string | null;
      seed_version: number | null;
    }>("GET", "/api/kb/status"),
  kbSync: (embed = true) =>
    request<{
      inserted_diseases: number;
      inserted_features: number;
      embedded_features: number;
      embed_failures: number;
    }>("POST", `/api/kb/sync?embed=${embed}`),

  // brief
  generateBrief: (body?: { from_?: string; to?: string; enrich?: boolean }) =>
    request<{ markdown: string; stats: BriefStats }>(
      "POST",
      "/api/insights/brief",
      body ?? {},
    ),
  briefHtmlUrl: (params?: { from?: string; to?: string; enrich?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.enrich) q.set("enrich", "true");
    const suffix = q.toString();
    return suffix ? `/api/insights/brief.html?${suffix}` : "/api/insights/brief.html";
  },

  // demo
  listPersonas: () =>
    request<{ id: string; title: string; summary: string }[]>("GET", "/api/demo/personas"),
  loadPersona: (persona_id: string, overwrite = false) =>
    request<{
      persona_id: string;
      entries: number;
      documents: number;
      lab_values: number;
      medications: number;
    }>("POST", "/api/demo/load", { persona_id, overwrite }),
  activePersona: () =>
    request<{ persona_id: string | null }>("GET", "/api/demo/active"),
};

export interface EntryEntity {
  id: string;
  type: string;
  canonical_name: string;
  attrs: string | null;
}

export interface LlmStatus {
  ollama: boolean;
  url: string;
  models: Record<string, boolean>;
  installed?: string[];
}

export interface EntitySummary {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  mention_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface EntityMentionSnippet {
  id: string;
  entry_id: string;
  ts_event: string;
  snippet: string;
  attrs: Record<string, unknown>;
}

export interface EntityNeighbor {
  id: string;
  name: string;
  kind: string;
  weight: number;
  evidence_count: number;
}

export interface EntityDetail extends EntitySummary {
  recent_mentions: EntityMentionSnippet[];
  neighbors: EntityNeighbor[];
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  mention_count: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  weight: number;
  evidence_count: number;
  last_observed_at: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface QueueStatus {
  queued: number;
  running: number;
  done: number;
  failed: number;
}

export type MediaKind = "image" | "audio" | "document";

export interface Media {
  id: string;
  entry_id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  description: string | null;
  transcript: string | null;
  status: "pending" | "running" | "done" | "failed";
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface LabValue {
  id: string;
  test_name: string;
  test_name_raw: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  reference_low: number | null;
  reference_high: number | null;
  is_abnormal: number | null;
  measured_at: string | null;
}

export interface MedicationRecord {
  id: string;
  drug_name: string;
  drug_name_raw: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  prescribed_at: string | null;
}

export interface DocumentRecord {
  id: string;
  media_id: string;
  entry_id: string;
  doc_type: string;
  doc_date: string | null;
  clinician_name: string | null;
  clinician_specialty: string | null;
  facility: string | null;
  language_detected: string | null;
  findings_md: string | null;
  recommendations_md: string | null;
  user_verified: number;
  lab_values: LabValue[];
  medications: MedicationRecord[];
  created_at: string;
  updated_at: string;
}

export interface LabPoint {
  measured_at: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  is_abnormal: number | null;
  reference_low: number | null;
  reference_high: number | null;
  document_id: string;
}

export interface LabSeries {
  test_name: string;
  points: LabPoint[];
}

export type SignalStrength = "weak" | "moderate" | "strong";
export type HypothesisStatus = "active" | "dismissed" | "expired" | "confirmed";

export interface MatchedFeature {
  feature_name: string;
  frequency_class: string;
  similarity: number;
  matched_signal: string;
  signal_kind: string;
}

export interface Hypothesis {
  id: string;
  disease_id: string;
  disease_name: string;
  category: string | null;
  source_url: string;
  red_flag: number;
  match_score: number;
  signal_strength: SignalStrength;
  rationale_md: string;
  suggested_actions_md: string | null;
  cited_entry_ids: string[];
  cited_lab_value_ids: string[];
  cited_medication_ids: string[];
  matched_features: MatchedFeature[];
  status: HypothesisStatus;
  generated_at: string;
  expires_at: string;
  user_note: string | null;
  dismissed_reason: string | null;
}

export interface BriefStats {
  entries: number;
  documents: number;
  abnormal_labs: number;
  medications: number;
  hypotheses: number;
}

/**
 * Streams NDJSON progress lines from POST /api/llm/pull.
 * Each line is a JSON object emitted by Ollama: `{status, digest?, total?, completed?}`.
 * Resolves when the stream ends or when an `{error: ...}` line is seen.
 */
export async function streamPull(
  model: string,
  onChunk: (chunk: PullChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch("/api/llm/pull", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal,
  });
  if (!r.ok || !r.body) {
    throw new ApiError(r.status, await r.text());
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onChunk(JSON.parse(line) as PullChunk);
      } catch {
        // ignore non-JSON lines
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      onChunk(JSON.parse(tail) as PullChunk);
    } catch {
      // ignore
    }
  }
}

export interface PullChunk {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}
