import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Entry } from "../api/client";
import { api } from "../api/client";
import EntryEditor from "../components/EntryEditor";
import type { EntryDraft } from "../components/EntryEditor";
import TimelineView from "../components/TimelineView";
import DemoMenu from "../components/DemoMenu";

type EditState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; entry: Entry };

export default function Timeline() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [edit, setEdit] = useState<EditState>({ mode: "closed" });

  const entries = useQuery({
    queryKey: ["entries", { tag: filter }],
    queryFn: () => api.listEntries(filter ? { tag: filter } : undefined),
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });

  const createM = useMutation({
    mutationFn: (draft: EntryDraft) => api.createEntry(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      setEdit({ mode: "closed" });
    },
  });

  const updateM = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: EntryDraft }) =>
      api.updateEntry(id, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      setEdit({ mode: "closed" });
    },
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => api.deleteEntry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      setEdit({ mode: "closed" });
    },
  });

  const lockM = useMutation({
    mutationFn: () => api.lock(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
  });

  const queue = useQuery({
    queryKey: ["queue", "status"],
    queryFn: api.queueStatus,
    refetchInterval: 3_000,
  });
  const llm = useQuery({
    queryKey: ["llm", "status"],
    queryFn: api.llmStatus,
    refetchInterval: 30_000,
  });

  function openEntry(id: string) {
    const found = (entries.data ?? []).find((x) => x.id === id);
    if (found) setEdit({ mode: "edit", entry: found });
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-semibold">{t("timeline.heading")}</h1>
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={() => setFilter(undefined)}
            className={`text-sm px-2 py-1 rounded ${
              filter === undefined ? "bg-accent/20 text-ink" : "text-ink/60 hover:text-ink"
            }`}
          >
            {t("timeline.filterAll")}
          </button>
          {(tags.data ?? []).map((tag) => (
            <button
              key={tag.id}
              onClick={() => setFilter(tag.id)}
              className={`text-sm px-2 py-1 rounded ${
                filter === tag.id ? "bg-accent/20 text-ink" : "text-ink/60 hover:text-ink"
              }`}
              style={filter === tag.id && tag.color ? { color: tag.color } : undefined}
            >
              #{tag.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <QueueIndicator
            queued={(queue.data?.queued ?? 0) + (queue.data?.running ?? 0)}
            failed={queue.data?.failed ?? 0}
            ollamaUp={llm.data?.ollama ?? false}
          />
          <Link to="/graph" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.graph")}
          </Link>
          <Link
            to="/hypotheses"
            className="text-sm text-amber-300 hover:text-amber-200"
            title={t("nav.hypothesesHint")}
          >
            ✦ {t("nav.hypotheses")}
          </Link>
          <Link to="/insights" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.brief")}
          </Link>
          <Link to="/documents" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.documents")}
          </Link>
          <Link to="/labs" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.labs")}
          </Link>
          <Link to="/medications" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.medications")}
          </Link>
          <Link to="/llm" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.ai")}
          </Link>
          <Link to="/tags" className="text-sm text-ink/60 hover:text-ink">
            {t("timeline.tags")}
          </Link>
          <DemoMenu entryCount={(entries.data ?? []).length} />
          <button
            onClick={() => setEdit({ mode: "create" })}
            className="bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-md text-sm font-medium"
          >
            {t("timeline.newEntry")}
          </button>
          <button
            onClick={() => lockM.mutate()}
            className="border border-ink/20 hover:bg-ink/5 px-3 py-1.5 rounded-md text-sm"
          >
            {t("timeline.lock")}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {entries.isLoading ? (
          <div className="p-6 text-ink/60">{t("timeline.loading")}</div>
        ) : entries.data && entries.data.length === 0 ? (
          <div className="p-6 text-ink/60">{t("timeline.noEntries")}</div>
        ) : (
          <TimelineView entries={entries.data ?? []} onSelect={openEntry} />
        )}
      </main>

      {edit.mode !== "closed" && (
        <Modal onClose={() => setEdit({ mode: "closed" })}>
          <EntryEditor
            initial={edit.mode === "edit" ? edit.entry : undefined}
            tags={tags.data ?? []}
            saving={createM.isPending || updateM.isPending}
            onSave={(draft) => {
              if (edit.mode === "edit") {
                updateM.mutate({ id: edit.entry.id, draft });
              } else {
                createM.mutate(draft);
              }
            }}
            onCancel={() => setEdit({ mode: "closed" })}
            onDelete={
              edit.mode === "edit"
                ? () => deleteM.mutate(edit.entry.id)
                : undefined
            }
          />
        </Modal>
      )}
    </div>
  );
}

function QueueIndicator({
  queued,
  failed,
  ollamaUp,
}: {
  queued: number;
  failed: number;
  ollamaUp: boolean;
}) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.retryFailedJobs(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue", "status"] }),
  });

  if (queued === 0 && failed === 0) {
    return ollamaUp ? null : (
      <Link
        to="/llm"
        className="text-xs px-2 py-1 rounded-full border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
        title="Ollama not reachable — click to set up"
      >
        ⚠ Ollama offline
      </Link>
    );
  }
  return (
    <span className="text-xs flex items-center gap-2">
      {queued > 0 && (
        <span className="px-2 py-1 rounded-full bg-accent/15 text-ink/80">
          {queued} processing
        </span>
      )}
      {failed > 0 && (
        <button
          type="button"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          title={
            retry.isPending
              ? "Re-queueing…"
              : `${failed} entr${failed === 1 ? "y's" : "ies'"} AI extraction failed. Click to retry.`
          }
          className="px-2 py-1 rounded-full border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-60"
        >
          {retry.isPending ? "↻ retrying" : `↻ ${failed} failed`}
        </button>
      )}
    </span>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-ink/20 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
