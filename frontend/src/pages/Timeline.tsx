import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Entry } from "../api/client";
import { api } from "../api/client";
import EntryEditor from "../components/EntryEditor";
import type { EntryDraft } from "../components/EntryEditor";
import DemoMenu from "../components/DemoMenu";
import { Icons, Modal, MoodDots, ScreenHeader, SeverityBar, Tab } from "../ui/clario";
import { DEMO } from "../ui/demo";

type EditState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; entry: Entry };

interface Row {
  id: string;
  ts: string;
  text: string;
  mood: number | null;
  severity: number | null;
  tagObjs: { id: string; name: string; color: string }[];
  entities: string[];
  real: boolean;
  entry?: Entry;
}

const TAG_FALLBACK = "oklch(58% 0.08 215)";

export default function Timeline() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [edit, setEdit] = useState<EditState>({ mode: "closed" });

  const entriesQ = useQuery({
    queryKey: ["entries", { tag: filter }],
    queryFn: () => api.listEntries(filter ? { tag: filter } : undefined),
  });
  const allEntriesQ = useQuery({ queryKey: ["entries", { tag: undefined }], queryFn: () => api.listEntries() });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const activePersonaQ = useQuery({ queryKey: ["demo", "active"], queryFn: api.activePersona });
  const personasQ = useQuery({ queryKey: ["demo", "personas"], queryFn: api.listPersonas });

  const createM = useMutation({
    mutationFn: (draft: EntryDraft) => api.createEntry(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      setEdit({ mode: "closed" });
    },
  });
  const updateM = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: EntryDraft }) => api.updateEntry(id, draft),
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

  const realEntries = entriesQ.data ?? [];
  const hasReal = (allEntriesQ.data ?? []).length > 0;
  const isDemo = !hasReal;

  // Greeting name follows the loaded demo persona ("Maria · 26y · …" → "Maria"),
  // falling back to the bundled sample only when no persona is active.
  const activeId = activePersonaQ.data?.persona_id ?? null;
  const personaTitle = personasQ.data?.find((p) => p.id === activeId)?.title;
  const patientName =
    personaTitle?.split("·")[0].trim().split(" ")[0] ||
    DEMO.user.name.split(" ")[0];

  // Tag palette: real tags, falling back to the design's demo tags so the
  // filter row and chips read well on an empty journal.
  const realTags = tagsQ.data ?? [];
  const tagPalette = useMemo(() => {
    if (realTags.length > 0) {
      return realTags.map((tg) => ({ id: tg.id, name: tg.name, color: tg.color || TAG_FALLBACK }));
    }
    return DEMO.tags;
  }, [realTags]);
  const tagById = useMemo(
    () => Object.fromEntries(tagPalette.map((tg) => [tg.id, tg])),
    [tagPalette],
  );

  const rows: Row[] = useMemo(() => {
    if (hasReal) {
      const list = realEntries.map<Row>((e) => ({
        id: e.id,
        ts: e.ts_event,
        text: e.text_md,
        mood: e.mood,
        severity: e.severity,
        tagObjs: e.tags.map((tg) => ({
          id: tg.id,
          name: tg.name,
          color: tg.color || TAG_FALLBACK,
        })),
        entities: [],
        real: true,
        entry: e,
      }));
      return list;
    }
    const demo = DEMO.entries.filter((e) => (filter ? e.tags.includes(filter) : true));
    return demo.map<Row>((e) => ({
      id: e.id,
      ts: e.ts,
      text: e.text,
      mood: e.mood,
      severity: e.severity,
      tagObjs: e.tags.map((id) => tagById[id]).filter(Boolean),
      entities: e.entities,
      real: false,
    }));
  }, [hasReal, realEntries, filter, tagById]);

  const groups = useMemo(() => {
    const out: Record<string, Row[]> = {};
    rows.forEach((r) => {
      const d = r.ts.slice(0, 10);
      (out[d] = out[d] || []).push(r);
    });
    return Object.entries(out).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  const heatmapDays = useMemo(() => buildHeatmap(rows, isDemo), [rows, isDemo]);

  function openRow(r: Row) {
    if (r.real && r.entry) setEdit({ mode: "edit", entry: r.entry });
  }

  return (
    <>
      <ScreenHeader
        title={greeting(patientName)}
        sub="One line a day is enough — the engine takes care of the rest."
        actions={
          <>
            <DemoMenu entryCount={(allEntriesQ.data ?? []).length} />
            <button className="btn primary" onClick={() => setEdit({ mode: "create" })}>
              <span style={{ display: "inline-flex" }}>{Icons.plus}</span>
              {t("timeline.newEntry")}
            </button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: "4px 28px 28px" }}>
        <AppointmentBanner />

        <QuickLogHero
          allTags={tagPalette}
          onCreate={(draft) => createM.mutate(draft)}
          onMore={() => setEdit({ mode: "create" })}
        />

        <SeverityStrip days={heatmapDays} />

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            margin: "28px 0 10px",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {t("timeline.heading")}
            {isDemo && (
              <span
                className="pill"
                style={{ marginLeft: 10, fontSize: 10.5, height: 20, verticalAlign: "middle" }}
              >
                sample data
              </span>
            )}
          </h2>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Tab active={filter === undefined} onClick={() => setFilter(undefined)} count={rows.length}>
              {t("timeline.filterAll")}
            </Tab>
            {tagPalette.map((tg) => (
              <Tab key={tg.id} active={filter === tg.id} onClick={() => setFilter(tg.id)}>
                <span
                  aria-hidden="true"
                  style={{ width: 6, height: 6, borderRadius: 999, background: tg.color, display: "inline-block" }}
                />
                #{tg.name}
              </Tab>
            ))}
          </div>
        </div>

        {entriesQ.isLoading ? (
          <div style={{ padding: 24, color: "var(--ink-3)" }}>{t("timeline.loading")}</div>
        ) : groups.length === 0 ? (
          <EntriesEmptyState
            filtered={filter !== undefined}
            onClear={() => setFilter(undefined)}
            onLog={() => setEdit({ mode: "create" })}
          />
        ) : (
          groups.map(([day, items]) => (
            <section key={day} style={{ marginBottom: 18 }}>
              <DayHeader date={day} />
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "var(--shadow-1)",
                }}
              >
                {items.map((r, i) => (
                  <EntryRow key={r.id} row={r} isLast={i === items.length - 1} onClick={() => openRow(r)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {edit.mode !== "closed" && (
        <Modal onClose={() => setEdit({ mode: "closed" })} width={680}>
          <EntryEditor
            initial={edit.mode === "edit" ? edit.entry : undefined}
            tags={tagsQ.data ?? []}
            saving={createM.isPending || updateM.isPending}
            onSave={(draft) => {
              if (edit.mode === "edit") updateM.mutate({ id: edit.entry.id, draft });
              else createM.mutate(draft);
            }}
            onCancel={() => setEdit({ mode: "closed" })}
            onDelete={edit.mode === "edit" ? () => deleteM.mutate(edit.entry.id) : undefined}
          />
        </Modal>
      )}
    </>
  );
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

/* ─── Appointment banner (demo context — no appointment model yet) ───── */
function AppointmentBanner() {
  const apt = DEMO.appointment;
  const d = new Date(apt.date);
  const when =
    d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <a
      href="/insights"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        cursor: "pointer",
        padding: "12px 16px",
        borderRadius: 12,
        marginBottom: 16,
        textDecoration: "none",
        background: "color-mix(in oklch, var(--accent) 6%, var(--surface))",
        border: "1px solid color-mix(in oklch, var(--accent) 18%, var(--border))",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--accent-strong)",
          padding: "4px 10px",
          borderRadius: 6,
          background: "var(--surface)",
        }}
      >
        {apt.daysUntil} days
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--ink)" }}>
          <b style={{ fontWeight: 600 }}>{apt.title}</b>
          <span style={{ color: "var(--ink-3)" }}> · {when}</span>
        </div>
      </div>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Prep the clinician brief</span>
      <span style={{ color: "var(--accent)", display: "inline-flex" }}>{Icons.chev}</span>
    </a>
  );
}

/* ─── Quick-log hero — single primary action, wired to createEntry ──── */
function QuickLogHero({
  allTags,
  onCreate,
  onMore,
}: {
  allTags: { id: string; name: string; color: string }[];
  onCreate: (draft: EntryDraft) => void;
  onMore: () => void;
}) {
  const [sev, setSev] = useState(5);
  const [mood, setMood] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const moodColors = ["var(--coral)", "var(--coral)", "var(--ink-3)", "var(--sage)", "var(--sage)"];
  const moodLabels = ["very low", "low", "neutral", "good", "great"];
  const sevColor = sev <= 3 ? "var(--sage)" : sev <= 6 ? "var(--amber)" : "var(--coral)";
  const sevLabel =
    sev <= 1 ? "barely there" : sev <= 3 ? "mild" : sev <= 6 ? "moderate" : sev <= 8 ? "severe" : "unbearable";

  // Only tag IDs that exist as real DB tags can be attached on create; demo
  // tag IDs (t1…) are not real rows, so we attach by id only when realish.
  const realTagIds = new Set(allTags.filter((tg) => !/^t\d+$/.test(tg.id)).map((tg) => tg.id));

  function logIt() {
    const picked = allTags.filter((tg) => tags.includes(tg.id));
    const note =
      `Quick check-in — feeling ${moodLabels[mood + 2]}, severity ${sev}/10` +
      (picked.length ? ` (${picked.map((p) => "#" + p.name).join(", ")})` : "") +
      ".";
    onCreate({
      ts_event: new Date().toISOString(),
      text_md: note,
      mood,
      severity: sev,
      tag_ids: tags.filter((id) => realTagIds.has(id)),
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setTags([]);
    }, 1800);
  }

  const Face = ({ v, active }: { v: number; active: boolean }) => {
    const stroke = active ? moodColors[v + 2] : "var(--ink-4)";
    const expr: Record<number, JSX.Element> = {
      [-2]: <path d="M10 21 Q16 16 22 21" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />,
      [-1]: <path d="M10 20 Q16 17 22 20" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />,
      [0]: <path d="M10 20 L22 20" stroke={stroke} strokeWidth="2" strokeLinecap="round" />,
      [1]: <path d="M10 19 Q16 22 22 19" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />,
      [2]: <path d="M10 19 Q16 24 22 19" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />,
    };
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r="14"
          fill={active ? `color-mix(in oklch, ${moodColors[v + 2]} 14%, white)` : "transparent"}
          stroke={stroke}
          strokeWidth="1.6"
        />
        <circle cx="12" cy="14" r="1.4" fill={stroke} />
        <circle cx="20" cy="14" r="1.4" fill={stroke} />
        {expr[v]}
      </svg>
    );
  };

  return (
    <section
      aria-label="Quick log"
      style={{
        borderRadius: "var(--r-lg)",
        padding: "var(--s-5) var(--s-6)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-2)",
        marginBottom: "var(--s-7)",
      }}
    >
      <div style={{ fontSize: "var(--t-md)", fontWeight: 600, color: "var(--ink)", letterSpacing: -0.2 }}>
        How are you feeling right now?
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "var(--s-6)",
          alignItems: "center",
          marginTop: "var(--s-4)",
        }}
      >
        <div role="radiogroup" aria-label="Mood" style={{ display: "flex", gap: "var(--s-1)" }}>
          {[-2, -1, 0, 1, 2].map((v) => (
            <button
              key={v}
              onClick={() => setMood(v)}
              role="radio"
              aria-checked={mood === v}
              aria-label={`Mood: ${moodLabels[v + 2]}`}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, borderRadius: 8 }}
            >
              <Face v={v} active={mood === v} />
            </button>
          ))}
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "var(--s-1)",
            }}
          >
            <label htmlFor="quicklog-severity" style={{ fontSize: "var(--t-xs)", color: "var(--ink-3)" }}>
              Severity
            </label>
            <span style={{ fontSize: "var(--t-sm)", color: sevColor, fontWeight: 600 }}>
              <span className="mono" style={{ fontSize: "var(--t-base)" }}>
                {sev}
              </span>
              /10 · {sevLabel}
            </span>
          </div>
          <input
            id="quicklog-severity"
            type="range"
            min={0}
            max={10}
            value={sev}
            onChange={(e) => setSev(+e.target.value)}
            aria-label={`Severity ${sev} of 10, ${sevLabel}`}
            style={{ width: "100%", accentColor: sevColor, height: 4 }}
          />
        </div>
      </div>

      <div
        role="group"
        aria-label="Tags"
        style={{ marginTop: "var(--s-4)", display: "flex", flexWrap: "wrap", gap: 5 }}
      >
        {allTags.map((tg) => {
          const on = tags.includes(tg.id);
          return (
            <button
              key={tg.id}
              onClick={() => setTags(on ? tags.filter((x) => x !== tg.id) : [...tags, tg.id])}
              aria-pressed={on}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 26,
                padding: "0 11px",
                borderRadius: 999,
                cursor: "pointer",
                border:
                  "1px solid " +
                  (on ? `color-mix(in oklch, ${tg.color} 50%, transparent)` : "var(--border)"),
                background: on ? `color-mix(in oklch, ${tg.color} 12%, white)` : "var(--surface)",
                color: on ? tg.color : "var(--ink-2)",
                fontSize: "var(--t-sm)",
                fontWeight: on ? 600 : 500,
              }}
            >
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: tg.color }} />
              #{tg.name}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "var(--s-5)", display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
        <button
          className="btn primary"
          onClick={logIt}
          disabled={saved}
          style={{ height: 38, padding: "0 22px", fontSize: "var(--t-base)" }}
        >
          {saved ? (
            <>
              <span style={{ display: "inline-flex" }}>{Icons.check}</span>Saved
            </>
          ) : (
            "Log this"
          )}
        </button>
        <button className="btn ghost" onClick={onMore} style={{ height: 38, fontSize: "var(--t-base)" }}>
          Add details
        </button>
        {saved && (
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "var(--t-sm)",
              color: "var(--sage)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              animation: "fadeIn var(--d-base) var(--ease)",
            }}
          >
            Logged at {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · added to today
          </span>
        )}
      </div>
    </section>
  );
}

interface HeatDay {
  date: string;
  sev: number;
  real: boolean;
  count: number;
}

function buildHeatmap(rows: Row[], isDemo: boolean): HeatDay[] {
  const today = isDemo ? new Date("2026-05-16") : new Date();
  const days: HeatDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dayRows = rows.filter((r) => r.ts.slice(0, 10) === iso);
    const maxSev = dayRows.reduce((m, r) => Math.max(m, r.severity ?? 0), 0);
    const seed = (d.getDate() * 13 + d.getMonth() * 7) % 11;
    const sev =
      dayRows.length > 0
        ? maxSev
        : isDemo
          ? seed === 0
            ? 0
            : seed < 4
              ? Math.max(2, seed)
              : seed
          : 0;
    days.push({ date: iso, sev, real: dayRows.length > 0, count: dayRows.length });
  }
  return days;
}

function SeverityStrip({ days }: { days: HeatDay[] }) {
  function color(s: number) {
    if (s === 0) return "var(--surface-2)";
    const tt = Math.min(s / 10, 1);
    if (s <= 3) return `color-mix(in oklch, var(--sage) ${Math.round(30 + tt * 35)}%, white)`;
    if (s <= 6) return `color-mix(in oklch, var(--amber) ${Math.round(40 + tt * 35)}%, white)`;
    return `color-mix(in oklch, var(--coral) ${Math.round(45 + tt * 40)}%, white)`;
  }
  const streak = days.filter((d) => d.real).length;
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: 14,
        padding: "18px 22px",
        boxShadow: "var(--shadow-1)",
        display: "flex",
        alignItems: "center",
        gap: 28,
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Last 30 days</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>warmer = worse day</div>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "repeat(30, 1fr)",
          gap: 5,
        }}
      >
        {days.map((d, i) => (
          <div
            key={i}
            title={`${d.date} · severity ${d.sev}/10${d.real ? ` · ${d.count} entries` : ""}`}
            style={{
              aspectRatio: "1 / 1",
              borderRadius: 4,
              background: color(d.sev),
              outline: d.real ? "1.5px solid var(--ink)" : "none",
              outlineOffset: d.real ? "-1.5px" : 0,
            }}
          />
        ))}
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {streak}-day{streak === 1 ? "" : ""} logged
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>days with entries</div>
      </div>
    </div>
  );
}

function DayHeader({ date }: { date: string }) {
  const d = new Date(date);
  const diff = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000,
  );
  const rel = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : `${diff} days ago`;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, padding: "0 4px" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{rel}</span>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
        {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
      </span>
    </div>
  );
}

function EntryRow({ row, isLast, onClick }: { row: Row; isLast: boolean; onClick: () => void }) {
  const time = new Date(row.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr 200px 130px",
        gap: 14,
        alignItems: "flex-start",
        padding: "14px 18px",
        cursor: row.real ? "pointer" : "default",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", paddingTop: 1 }}>
        {time}
      </div>
      <div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)" }}>{row.text}</div>
        {row.entities.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {row.entities.map((en) => (
              <span
                key={en}
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  color: "var(--ink-3)",
                  border: "1px solid var(--border)",
                }}
              >
                {en}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 1 }}>
        {row.tagObjs.map((tg) => (
          <span
            key={tg.id}
            className="pill"
            style={{
              background: "transparent",
              color: tg.color,
              borderColor: `color-mix(in oklch, ${tg.color} 30%, var(--border))`,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: tg.color }} />
            {tg.name}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {row.mood != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MoodDots value={row.mood} />
            <span
              style={{
                fontSize: 10.5,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: 0.04,
              }}
            >
              mood
            </span>
          </div>
        )}
        {row.severity != null && <SeverityBar value={row.severity} />}
      </div>
    </div>
  );
}

function EntriesEmptyState({
  filtered,
  onClear,
  onLog,
}: {
  filtered: boolean;
  onClear: () => void;
  onLog: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: 14,
        padding: "var(--s-7) var(--s-6)",
        textAlign: "center",
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          margin: "0 auto var(--s-3)",
          background: "var(--surface-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
        }}
        aria-hidden="true"
      >
        {Icons.search}
      </div>
      <div style={{ fontSize: "var(--t-md)", fontWeight: 600, color: "var(--ink)" }}>
        {filtered ? "No entries with this tag yet" : "Nothing logged yet"}
      </div>
      <p
        style={{
          margin: "var(--s-1) auto 0",
          maxWidth: 360,
          fontSize: "var(--t-sm)",
          color: "var(--ink-3)",
          lineHeight: 1.55,
        }}
      >
        {filtered
          ? "Once you tag an entry, it'll appear here. You can also clear the filter to see everything."
          : "Use the panel above to log how you feel, or write a longer note with photos and details."}
      </p>
      <div style={{ marginTop: "var(--s-4)", display: "inline-flex", gap: 8 }}>
        {filtered ? (
          <button className="btn" onClick={onClear}>
            Show all entries
          </button>
        ) : (
          <button className="btn primary" onClick={onLog}>
            Write a longer entry
          </button>
        )}
      </div>
    </div>
  );
}
