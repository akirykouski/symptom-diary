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
