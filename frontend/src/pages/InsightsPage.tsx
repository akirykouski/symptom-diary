import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api, AskCitation } from "../api/client";
import PairPhoneModal from "../components/PairPhoneModal";
import QrShareModal from "../components/QrShareModal";
import {
  Icons,
  Kbd,
  Pill,
  ScreenHeader,
} from "../ui/clario";
import { DEMO } from "../ui/demo";

/* ─── Types ───────────────────────────────────────────────────────────── */
interface BriefStats {
  entries: number;
  documents: number;
  abnormal_labs: number;
  medications: number;
  hypotheses: number;
}

/* ─── Constants ───────────────────────────────────────────────────────── */
const EXAMPLE_QUESTIONS = [
  "What patterns do you notice in my recent entries?",
  "How often did I mention headaches last month?",
  "What did I write about sleep last two weeks?",
  "Summarise the last month for a clinician.",
];

/* ─── Citation helpers ────────────────────────────────────────────────── */
const CITATION_RE = /\[entry-([a-f0-9]{4,12})\]/gi;

function CitePill({ id, onClick }: { id: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono"
      style={{
        fontSize: 11,
        padding: "0 6px",
        borderRadius: 4,
        background: "var(--accent-tint)",
        color: "var(--accent-strong)",
        border: "1px solid color-mix(in oklch, var(--accent) 25%, transparent)",
        cursor: onClick ? "pointer" : "default",
        lineHeight: 1.6,
        display: "inline",
      }}
    >
      entry-{id}
    </button>
  );
}

function renderWithCitations(
  text: string,
  byPrefix: Map<string, AskCitation>,
  onPillClick: (prefix: string) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const prefix = m[1].toLowerCase();
    const known = byPrefix.has(prefix);
    parts.push(
      <CitePill
        key={`pill-${key++}`}
        id={prefix}
        onClick={known ? () => onPillClick(prefix) : undefined}
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h4
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.08,
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  );
}

function BriefLabRow({
  label,
  value,
  unit,
  ref: ref_,
  flag,
}: {
  label: string;
  value: string;
  unit: string;
  ref: string;
  flag: "low" | "high" | "normal";
}) {
  const color =
    flag === "low" ? "var(--info)" : flag === "high" ? "var(--danger)" : "var(--ink)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.5fr 100px 60px 1fr 80px",
        padding: "6px 0",
        alignItems: "baseline",
        borderBottom: "1px solid var(--border)",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <span className="mono" style={{ fontWeight: 600, color }}>
        {value}
      </span>
      <span className="mono" style={{ color: "var(--ink-3)" }}>
        {unit}
      </span>
      <span className="mono" style={{ color: "var(--ink-3)" }}>
        {ref_}
      </span>
      <span>
        {flag === "low" ? (
          <Pill tone="info" dot>low</Pill>
        ) : flag === "high" ? (
          <Pill tone="danger" dot>high</Pill>
        ) : (
          <Pill tone="ok" dot>in range</Pill>
        )}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  accent?: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "14px 16px",
        background: accent ? "var(--accent-tint)" : undefined,
        border: accent
          ? "1px solid color-mix(in oklch, var(--accent) 22%, var(--border))"
          : undefined,
      }}
    >
      <div className="k-label" style={{ color: accent ? "var(--accent-strong)" : undefined }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: -0.5,
            color: accent ? "var(--accent-strong)" : "var(--ink)",
          }}
        >
          {value}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

/* ─── Ask panel (wired to real api.askInsight) ───────────────────────── */
function AskPanel() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [openCitation, setOpenCitation] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (q: string) => api.askInsight({ question: q }),
  });

  const examples = useMemo(() => {
    const list = t("ask.exampleList", { returnObjects: true }) as unknown;
    return Array.isArray(list) ? (list as string[]) : EXAMPLE_QUESTIONS;
  }, [t]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOpenCitation(null);
    ask.mutate(trimmed);
  };

  const result = ask.data;

  const citationByPrefix = useMemo(() => {
    const m = new Map<string, AskCitation>();
    for (const c of result?.citations ?? []) m.set(c.prefix, c);
    return m;
  }, [result]);

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
            {t("ask.heading", "Ask about your journal")}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
            {t(
              "ask.intro",
              "Stateless. Every answer cites the journal entries it draws on. Refuses prompts about dosing, self-harm, or diagnostic certainty.",
            )}
          </p>
        </div>
        <Pill tone="info" dot>
          local model
        </Pill>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <textarea
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(question);
          }}
          placeholder={
            t("ask.placeholder") ??
            "e.g. What patterns do you notice across my last month of entries?"
          }
          rows={2}
          style={{ resize: "none", fontSize: 13.5 }}
        />
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn primary"
            disabled={ask.isPending || !question.trim()}
            onClick={() => submit(question)}
          >
            {ask.isPending ? t("ask.submitting", "Thinking…") : t("ask.submit", "Ask")}
          </button>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            <Kbd>⌘</Kbd> + <Kbd>↵</Kbd>
          </span>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuestion(ex);
                  submit(ex);
                }}
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  color: "var(--ink-2)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                {ex.length > 38 ? `${ex.slice(0, 37)}…` : ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      {ask.isError && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--danger-tint)",
            border: "1px solid color-mix(in oklch, var(--danger) 25%, var(--border))",
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          {t("ask.errorGeneric", "Something went wrong. Please try again.")}
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 12, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {result.refusal ? (
              <Pill tone="danger">
                <span style={{ display: "inline-flex", width: 11, height: 11 }}>
                  {Icons.alert}
                </span>
                {t("ask.refusalBadge", "Refused")} · {result.refusal.category}
              </Pill>
            ) : (
              <Pill tone="ok">
                <span style={{ display: "inline-flex", width: 11, height: 11 }}>
                  {Icons.check}
                </span>
                {t("ask.answer", "Answer")}
              </Pill>
            )}
            {result.used_fallback && (
              <Pill tone="warn">{t("ask.fallbackBadge", "Fallback model")}</Pill>
            )}
            {!result.refusal && result.citations.length > 0 && (
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                · grounded in {result.citations.length} {result.citations.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </div>

          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink)" }}>
            {renderWithCitations(
              result.answer_md,
              citationByPrefix,
              (p) => setOpenCitation(openCitation === p ? null : p),
            )}
          </div>

          {openCitation && citationByPrefix.has(openCitation) && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: "var(--accent-tint)",
                border: "1px solid color-mix(in oklch, var(--accent) 25%, var(--border))",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span className="mono" style={{ color: "var(--ink-3)" }}>
                  [entry-{openCitation}] ·{" "}
                  {citationByPrefix.get(openCitation)!.ts_event.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenCitation(null)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--ink-3)",
                    display: "inline-flex",
                  }}
                  aria-label="close"
                >
                  {Icons.x}
                </button>
              </div>
              <p style={{ margin: 0, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                {citationByPrefix.get(openCitation)!.snippet}
              </p>
            </div>
          )}

          {!result.refusal && result.citations.length > 0 && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div className="k-label" style={{ marginBottom: 8 }}>
                {t("ask.citations", "Cited journal entries")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.citations.map((c) => (
                  <button
                    key={c.entry_id}
                    type="button"
                    onClick={() =>
                      setOpenCitation(openCitation === c.prefix ? null : c.prefix)
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns: "90px 80px 1fr",
                      gap: 10,
                      padding: "8px 10px",
                      background: "var(--surface-2)",
                      borderRadius: 8,
                      fontSize: 12,
                      alignItems: "baseline",
                      textAlign: "left",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  >
                    <span className="mono" style={{ color: "var(--accent-strong)" }}>
                      entry-{c.prefix}
                    </span>
                    <span className="mono" style={{ color: "var(--ink-3)" }}>
                      {c.ts_event.slice(0, 10)}
                    </span>
                    <span style={{ color: "var(--ink)" }}>{c.snippet}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */
export default function InsightsPage() {
  const { t } = useTranslation();
  const [enrich, setEnrich] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showPair, setShowPair] = useState(false);

  const generate = useMutation({
    mutationFn: () => api.generateBrief({ enrich }),
  });

  const briefData = generate.data;
  const stats: BriefStats = briefData?.stats ?? DEMO.briefStats;
  const isDemo = !briefData;
  const appt = DEMO.appointment;

  return (
    <>
      <ScreenHeader
        title={t("insights.heading", "Clinician brief")}
        sub={t(
          "insights.sub",
          "A printable, citation-linked summary of everything in your journal.",
        )}
        actions={
          <>
            <button className="btn" type="button" onClick={() => setShowPair(true)}>
              <span style={{ display: "inline-flex" }}>{Icons.mobile}</span>
              {t("pair.openButton", "Pair phone")}
            </button>
            <button className="btn" type="button" onClick={() => setShowQr(true)}>
              <span style={{ display: "inline-flex" }}>{Icons.qr}</span>
              {t("qr.openButton", "Share via QR")}
            </button>
            <a
              href={api.bundleExportUrl()}
              download
              className="btn"
            >
              <span style={{ display: "inline-flex" }}>{Icons.download}</span>
              {t("bundle.exportButton", "Download .diary")}
            </a>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            padding: "20px 28px 28px",
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          {/* ── Main column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>

            {/* For your visit — hero card (uses DEMO.appointment as contextual demo) */}
            <div
              style={{
                borderRadius: 16,
                padding: "20px 22px",
                background:
                  "linear-gradient(135deg, var(--accent-tint) 0%, var(--surface) 70%)",
                border:
                  "1px solid color-mix(in oklch, var(--accent) 22%, var(--border))",
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: "var(--accent)",
                  color: "white",
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}
                >
                  {appt.daysUntil}
                </div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.9, letterSpacing: 0.06 }}>
                  DAYS
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div className="k-label" style={{ color: "var(--accent-strong)" }}>
                  {t("insights.forVisit", "For your upcoming visit")}
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: "var(--ink)",
                    letterSpacing: -0.2,
                    marginTop: 2,
                  }}
                >
                  {appt.title}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                  {t(
                    "insights.visitHint",
                    "Print this brief and bring it on paper, or share live by QR from the clinic.",
                  )}
                </div>
              </div>
              <a
                href={api.briefPdfUrl({ enrich })}
                download
                className="btn primary"
              >
                <span style={{ display: "inline-flex" }}>{Icons.download}</span>
                {t("insights.downloadPdf", "Download PDF")}
              </a>
              <button className="btn" type="button" onClick={() => setShowQr(true)}>
                <span style={{ display: "inline-flex" }}>{Icons.qr}</span>
                {t("qr.openButton", "Share via QR")}
              </button>
            </div>

            {/* Ask panel */}
            <AskPanel />

            {/* Generated brief card */}
            <div className="card" style={{ padding: 0 }}>
              <div
                style={{
                  padding: "18px 22px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
                  {t("insights.briefHeading", "Generated brief")}
                </h2>
                {isDemo ? (
                  <span
                    className="pill"
                    style={{ fontSize: 10.5, height: 20 }}
                  >
                    sample data
                  </span>
                ) : (
                  <Pill tone="ok" dot>
                    up to date
                  </Pill>
                )}
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    color: "var(--ink-2)",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enrich}
                      onChange={(e) => setEnrich(e.target.checked)}
                    />
                    {t("insights.enrich", "AI narrative summary")}
                  </label>
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => generate.mutate()}
                    disabled={generate.isPending}
                  >
                    {generate.isPending
                      ? t("insights.generating", "Generating…")
                      : t("insights.generate", "Regenerate")}
                  </button>
                  <a
                    href={api.briefHtmlUrl({ enrich })}
                    target="_blank"
                    rel="noreferrer"
                    className="btn sm"
                  >
                    <span style={{ display: "inline-flex" }}>{Icons.ext}</span>
                    {t("insights.printable", "Open printable")}
                  </a>
                  <a
                    href={api.briefPdfUrl({ enrich })}
                    download
                    className="btn sm primary"
                  >
                    <span style={{ display: "inline-flex" }}>{Icons.download}</span>
                    {t("insights.downloadPdf", "Download PDF")}
                  </a>
                </div>
              </div>

              <div
                style={{
                  padding: "28px 36px 36px",
                  maxWidth: 720,
                  lineHeight: 1.65,
                }}
              >
                {briefData ? (
                  /* Real data — render markdown as pre-wrapped text */
                  <>
                    <h3
                      style={{
                        margin: "0 0 4px",
                        fontSize: 22,
                        fontWeight: 600,
                        letterSpacing: -0.3,
                        color: "var(--ink)",
                      }}
                    >
                      {t("insights.briefTitle", "Clinical context")}
                    </h3>
                    <div
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--ink-3)" }}
                    >
                      {t("insights.generated", "Generated")} {new Date().toISOString().slice(0, 10)} ·{" "}
                      {briefData.stats.entries} {t("insights.entries", "entries")} ·{" "}
                      {briefData.stats.documents} {t("insights.documents", "documents")}
                    </div>
                    <pre
                      style={{
                        marginTop: 20,
                        fontSize: 13.5,
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        color: "var(--ink)",
                      }}
                    >
                      {briefData.markdown}
                    </pre>
                  </>
                ) : (
                  /* Demo fallback — design's BriefSection/BriefLabRow content */
                  <>
                    <h3
                      style={{
                        margin: "0 0 4px",
                        fontSize: 22,
                        fontWeight: 600,
                        letterSpacing: -0.3,
                        color: "var(--ink)",
                      }}
                    >
                      Clinical context — {DEMO.user.name}
                    </h3>
                    <div
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--ink-3)" }}
                    >
                      Generated {new Date().toISOString().slice(0, 10)} · 8 entries · 5 documents · window 90 days
                    </div>

                    <p style={{ marginTop: 18, fontSize: 14, color: "var(--ink)" }}>
                      Patient reports a 6-month pattern of fluctuating fatigue with unrefreshing
                      sleep, bilateral morning headaches, intermittent polyarthralgia in the knees
                      and PIP joints, and a single photo-distributed malar rash. April labs show
                      microcytic anemia (Hb 11.2 g/dL, MCV 78 fL, ferritin 8 ng/mL) and a
                      positive ANA at 1:320 with low C3.
                    </p>

                    <BriefSection title="Recent episodes">
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 13.5,
                          color: "var(--ink)",
                        }}
                      >
                        <li>
                          Morning headaches, bilateral temple, mild–moderate (4–6/10) on{" "}
                          <CitePill id="e1" />, <CitePill id="e5" />, <CitePill id="e6" />.
                        </li>
                        <li>
                          Joint stiffness in knees after prolonged sitting on{" "}
                          <CitePill id="e2" />; same day as PIP discomfort.
                        </li>
                        <li>
                          Malar rash with photo-distribution on <CitePill id="e4" />, faded by
                          evening.
                        </li>
                        <li>
                          Unrefreshing sleep with normal duration on <CitePill id="e3" />.
                        </li>
                      </ul>
                    </BriefSection>

                    <BriefSection title="Abnormal labs (4)">
                      <BriefLabRow
                        label="Ferritin"
                        value="8"
                        unit="ng/mL"
                        ref="13–150"
                        flag="low"
                      />
                      <BriefLabRow
                        label="Hemoglobin"
                        value="11.2"
                        unit="g/dL"
                        ref="12.0–15.5"
                        flag="low"
                      />
                      <BriefLabRow
                        label="MCV"
                        value="78"
                        unit="fL"
                        ref="80–100"
                        flag="low"
                      />
                      <BriefLabRow
                        label="ANA titer"
                        value="1:320"
                        unit=""
                        ref="< 1:80"
                        flag="high"
                      />
                    </BriefSection>

                    <BriefSection title="Medications">
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 13.5,
                          color: "var(--ink)",
                        }}
                      >
                        <li>Ferrous sulfate 65 mg once daily — 90 days (started 2026-04-25).</li>
                        <li>Ibuprofen 400 mg PRN for joint pain.</li>
                        <li>Vitamin D3 2000 IU once daily — ongoing.</li>
                      </ul>
                    </BriefSection>

                    <BriefSection title="Patterns AI noticed for clinician's consideration">
                      <ol
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 13.5,
                          color: "var(--ink)",
                        }}
                      >
                        <li>
                          <b>Iron-deficiency anemia</b> — strong signal (0.82). Microcytic picture
                          + persistent fatigue.
                        </li>
                        <li>
                          <b>Systemic lupus erythematosus</b> — moderate (0.61). Malar rash +
                          arthralgia + ANA 1:320 + low C3.
                        </li>
                        <li>
                          <b>Tension-type headache</b> — weak (0.34). Recurrent bilateral morning
                          headaches.
                        </li>
                      </ol>
                    </BriefSection>

                    <div
                      style={{
                        marginTop: 28,
                        padding: 14,
                        borderRadius: 10,
                        background: "var(--warn-tint)",
                        border:
                          "1px solid color-mix(in oklch, var(--warn) 25%, var(--border))",
                        fontSize: 12,
                        color: "oklch(34% 0.10 75)",
                      }}
                    >
                      This brief is patient-reported context for clinical evaluation. Every
                      assertion cites the underlying journal entry. It is not a diagnosis.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Stats sidebar ── */}
          <aside
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              position: "sticky",
              top: 0,
            }}
          >
            <div style={{ padding: "14px 16px" }}>
              <div className="k-label">
                {t("insights.briefCovers", "This brief covers")}
                {isDemo && (
                  <span
                    className="pill"
                    style={{ fontSize: 10.5, height: 20, marginLeft: 8 }}
                  >
                    sample data
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 4 }}>90 days</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                {stats.entries} {t("insights.entries", "entries")} ·{" "}
                {stats.documents} {t("insights.documents", "documents")} ·{" "}
                {stats.medications} {t("insights.medications", "medications")}
              </div>
            </div>

            <StatCard
              label={t("insights.stats.abnLabs", "Abnormal labs")}
              value={stats.abnormal_labs}
              sub={t("insights.stats.abnLabsSub", "flagged out-of-range values")}
            />
            <StatCard
              label={t("insights.stats.hypotheses", "AI patterns")}
              value={stats.hypotheses}
              sub={t("insights.stats.hypothesesSub", "patterns for clinician review")}
              accent="accent"
            />
            <StatCard
              label={t("insights.stats.medications", "Medications")}
              value={stats.medications}
              sub={t("insights.stats.medicationsSub", "active or recent")}
            />
          </aside>
        </div>
      </div>

      {showQr && <QrShareModal onClose={() => setShowQr(false)} />}
      {showPair && <PairPhoneModal onClose={() => setShowPair(false)} />}
    </>
  );
}
