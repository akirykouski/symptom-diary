import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import MDEditor from "@uiw/react-md-editor";
import type { Entry, Tag } from "../api/client";
import { api } from "../api/client";
import MediaPanel from "./MediaPanel";
import { Field, Icons, Kbd } from "../ui/clario";

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

const MOOD_LABELS = ["very low", "low", "neutral", "good", "great"];

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
  const [severity, setSeverity] = useState<number | null>(initial?.severity ?? 5);
  const [tagIds, setTagIds] = useState<string[]>((initial?.tags ?? []).map((tg) => tg.id));

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

  const sev = severity ?? 5;

  return (
    <form onSubmit={submit}>
      {/* Header */}
      <div
        style={{
          padding: "18px 22px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {initial ? t("entry.editTitle", { defaultValue: "Edit entry" }) : t("timeline.newEntry")}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
            <Kbd>⌘</Kbd>
            <span style={{ margin: "0 4px" }}>+</span>
            <Kbd>↵</Kbd> to save · markdown supported · attach photo or audio
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="btn ghost sm"
          style={{ padding: "0 8px" }}
          aria-label={t("entry.cancel")}
        >
          {Icons.x}
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label={t("entry.tsEvent")}>
          <input
            type="datetime-local"
            className="input mono"
            value={tsLocal}
            onChange={(e) => setTsLocal(e.target.value)}
            style={{ maxWidth: 240 }}
          />
        </Field>

        <Field label={t("entry.text")}>
          <div
            data-color-mode="light"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
            }}
          >
            <MDEditor value={text} onChange={(v) => setText(v ?? "")} height={220} />
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label={t("entry.mood")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {[-2, -1, 0, 1, 2].map((v, i) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMood(mood === v ? null : v)}
                  style={{
                    width: 44,
                    height: 36,
                    borderRadius: 10,
                    cursor: "pointer",
                    background: mood === v ? "var(--accent-tint)" : "transparent",
                    border:
                      mood === v
                        ? "1px solid color-mix(in oklch, var(--accent) 30%, var(--border))"
                        : "1px solid transparent",
                    fontSize: 11.5,
                    color: mood === v ? "var(--accent-strong)" : "var(--ink-2)",
                    fontWeight: mood === v ? 600 : 500,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <span className="mono" style={{ fontSize: 12 }}>
                    {v > 0 ? `+${v}` : v}
                  </span>
                  <span style={{ fontSize: 9.5, letterSpacing: 0.04, textTransform: "uppercase" }}>
                    {MOOD_LABELS[i]}
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={`${t("entry.severity")} · ${sev}/10`} hint={t("entry.severityHint")}>
            <input
              type="range"
              min={0}
              max={10}
              value={sev}
              onChange={(e) => setSeverity(+e.target.value)}
              style={{
                width: "100%",
                accentColor: sev <= 3 ? "var(--ok)" : sev <= 6 ? "var(--warn)" : "var(--danger)",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--ink-3)",
                marginTop: 2,
              }}
            >
              <span>none</span>
              <span>mild</span>
              <span>moderate</span>
              <span>severe</span>
              <span>unbearable</span>
            </div>
          </Field>
        </div>

        <Field label={t("entry.tags")}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                No tags yet — create them on the Tags page.
              </span>
            )}
            {tags.map((tg) => {
              const on = tagIds.includes(tg.id);
              const c = tg.color || "oklch(58% 0.08 215)";
              return (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() =>
                    setTagIds(on ? tagIds.filter((x) => x !== tg.id) : [...tagIds, tg.id])
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    padding: "0 11px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border:
                      "1px solid " +
                      (on ? `color-mix(in oklch, ${c} 50%, transparent)` : "var(--border)"),
                    background: on ? `color-mix(in oklch, ${c} 14%, var(--surface))` : "var(--surface)",
                    color: on ? c : "var(--ink-2)",
                    fontSize: 12,
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c }} />
                  #{tg.name}
                </button>
              );
            })}
          </div>
        </Field>

        {initial && (
          <div
            style={{
              background: "var(--surface-2)",
              borderRadius: 10,
              padding: 12,
              border: "1px solid var(--border)",
            }}
          >
            <MediaPanel entryId={initial.id} />
          </div>
        )}
        {initial && <ExtractedEntitiesPanel entryId={initial.id} />}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "var(--surface-2)",
        }}
      >
        <button
          type="submit"
          className="btn primary"
          disabled={saving || !text.trim()}
        >
          {saving ? t("entry.saving") : t("entry.save")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("entry.cancel")}
        </button>
        {onDelete && (
          <button type="button" className="btn danger" onClick={onDelete} style={{ marginLeft: "auto" }}>
            <span style={{ display: "inline-flex" }}>{Icons.trash}</span>
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entry", entryId, "entities"] }),
  });

  const list = ents.data ?? [];
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: 10,
        padding: 12,
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="k-label">{t("entries.extractedEntities")}</span>
        <button
          type="button"
          onClick={() => reextract.mutate()}
          disabled={reextract.isPending}
          className="btn ghost sm"
          style={{ marginLeft: "auto", height: 22 }}
        >
          <span style={{ display: "inline-flex" }}>{Icons.retry}</span>
          {t("entries.reextract")}
        </button>
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("entries.noneYet")}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {list.map((e) => (
            <span
              key={e.id}
              title={e.type}
              style={{
                fontSize: 11.5,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--surface)",
                color: "var(--ink-2)",
                border: "1px solid var(--border)",
              }}
            >
              {e.canonical_name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
