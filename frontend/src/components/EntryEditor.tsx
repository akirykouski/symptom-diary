import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import MDEditor from "@uiw/react-md-editor";
import type { Entry, Tag } from "../api/client";
import { api } from "../api/client";
import TagPicker from "./TagPicker";

export interface EntryDraft {
  ts_event: string;
  text_md: string;
  mood: number | null;
  severity: number | null;
  tag_ids: string[];
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInputValue(local: string): string {
  return new Date(local).toISOString();
}

export default function EntryEditor({
  initial,
  tags,
  onSave,
  onCancel,
  onDelete,
  saving = false,
}: {
  initial?: Entry;
  tags: Tag[];
  onSave: (draft: EntryDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const [tsLocal, setTsLocal] = useState<string>(
    toLocalInputValue(initial?.ts_event ?? new Date().toISOString()),
  );
  const [text, setText] = useState<string>(initial?.text_md ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [severity, setSeverity] = useState<number | null>(initial?.severity ?? null);
  const [tagIds, setTagIds] = useState<string[]>(
    (initial?.tags ?? []).map((tag) => tag.id),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSave({
      ts_event: fromLocalInputValue(tsLocal),
      text_md: text,
      mood,
      severity,
      tag_ids: tagIds,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-sm text-ink/70 mb-1">{t("entry.tsEvent")}</span>
        <input
          type="datetime-local"
          value={tsLocal}
          onChange={(e) => setTsLocal(e.target.value)}
          className="px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
        />
      </label>

      <div data-color-mode="dark">
        <span className="block text-sm text-ink/70 mb-1">{t("entry.text")}</span>
        <MDEditor value={text} onChange={(v) => setText(v ?? "")} height={240} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm text-ink/70 mb-1">{t("entry.mood")}</span>
          <select
            value={mood ?? ""}
            onChange={(e) => setMood(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20"
          >
            <option value="">—</option>
            {[-2, -1, 0, 1, 2].map((v) => (
              <option key={v} value={v}>
                {v} ({t(`entry.moodValues.${v}` as const)})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm text-ink/70 mb-1">
            {t("entry.severity")}{" "}
            <span className="text-ink/40">{t("entry.severityHint")}</span>
          </span>
          <input
            type="number"
            min={0}
            max={10}
            value={severity ?? ""}
            onChange={(e) =>
              setSeverity(e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20"
          />
        </label>
      </div>

      <div>
        <span className="block text-sm text-ink/70 mb-1">{t("entry.tags")}</span>
        <TagPicker tags={tags} selected={tagIds} onChange={setTagIds} />
      </div>

      {initial && <ExtractedEntitiesPanel entryId={initial.id} />}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium"
        >
          {saving ? t("entry.saving") : t("entry.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md border border-ink/20 hover:bg-ink/5"
        >
          {t("entry.cancel")}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto px-4 py-2 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            {t("entry.delete")}
          </button>
        )}
      </div>
    </form>
  );
}

function ExtractedEntitiesPanel({ entryId }: { entryId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ents = useQuery({
    queryKey: ["entry", entryId, "entities"],
    queryFn: () => api.entryEntities(entryId),
    refetchInterval: 4_000,
  });
  const reextract = useMutation({
    mutationFn: () => api.reextractEntry(entryId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["entry", entryId, "entities"] }),
  });

  const list = ents.data ?? [];
  return (
    <div className="border border-ink/10 rounded-md p-3 bg-ink/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-ink/40">
          {t("entries.extractedEntities")}
        </span>
        <button
          type="button"
          onClick={() => reextract.mutate()}
          disabled={reextract.isPending}
          className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-ink/10 disabled:opacity-50"
        >
          {t("entries.reextract")}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="text-xs text-ink/40">{t("entries.noneYet")}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((e) => (
            <span
              key={e.id}
              className="text-xs px-2 py-0.5 rounded-full border border-ink/15 text-ink/75"
              title={e.type}
            >
              {e.canonical_name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
