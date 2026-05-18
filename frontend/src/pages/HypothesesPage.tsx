import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Hypothesis, MatchedFeature, SignalStrength } from "../api/client";
import { api } from "../api/client";
import { Icons, Pill, ScreenHeader, Tab } from "../ui/clario";
import { DEMO, pick } from "../ui/demo";
import type { DemoHypothesis } from "../ui/demo";

/* ─── Signal palette (matches Clario design token map) ─────────────────── */
const SIGNAL: Record<
  SignalStrength,
  { label: string; bar: string; bg: string; fg: string; tone: "danger" | "warn" | "neutral" }
> = {
  strong: {
    label: "STRONG SIGNAL",
    bar: "var(--danger)",
    bg: "var(--danger-tint)",
    fg: "var(--danger)",
    tone: "danger",
  },
  moderate: {
    label: "MODERATE PATTERN",
    bar: "var(--warn)",
    bg: "var(--warn-tint)",
    fg: "oklch(45% 0.12 75)",
    tone: "warn",
  },
  weak: {
    label: "WEAK SIGNAL",
    bar: "var(--ink-4)",
    bg: "var(--surface-2)",
    fg: "var(--ink-2)",
    tone: "neutral",
  },
};

/* ─── Normalised shape accepted by HypothesisCard ───────────────────────── */
interface CardData {
  id: string;
  disease: string;
  category: string | null;
  signal: SignalStrength;
  score: number;
  redFlag: boolean;
  userConfirmed: boolean;
  rationale: string;
  suggested: string | null;
  citedEntries: string[];
  citedLabs: string[];
  citedMeds: string[];
  features: { signal: string; feature: string; freq: string; sim: number }[];
  sourceUrl: string;
  status: string;
  dismissedReason: string | null;
  corroboratedEntryIds: string[];
  isDemo: boolean;
}

function fromReal(h: Hypothesis): CardData {
  return {
    id: h.id,
    disease: h.disease_name,
    category: h.category,
    signal: h.signal_strength,
    score: h.match_score,
    redFlag: h.red_flag === 1,
    userConfirmed: h.user_confirmed,
    rationale: h.rationale_md,
    suggested: h.suggested_actions_md,
    citedEntries: h.cited_entry_ids,
    citedLabs: h.cited_lab_value_ids,
    citedMeds: h.cited_medication_ids,
    features: h.matched_features.map((f: MatchedFeature) => ({
      signal: f.matched_signal,
      feature: f.feature_name,
      freq: f.frequency_class,
      sim: f.similarity,
    })),
    sourceUrl: h.source_url,
    status: h.status,
    dismissedReason: h.dismissed_reason,
    corroboratedEntryIds: h.corroborated_entry_ids ?? [],
    isDemo: false,
  };
}

function fromDemo(h: DemoHypothesis): CardData {
  return {
    id: h.id,
    disease: h.disease,
    category: h.category,
    signal: h.signal,
    score: h.score,
    redFlag: h.redFlag,
    userConfirmed: h.userConfirmed,
    rationale: h.rationale,
    suggested: h.suggested,
    citedEntries: h.citedEntries,
    citedLabs: h.citedLabs,
    citedMeds: h.citedMeds,
    features: h.features,
    sourceUrl: "",
    status: "active",
    dismissedReason: null,
    corroboratedEntryIds: [],
    isDemo: true,
  };
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function HypothesesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "dismissed" | "confirmed">(
    "active",
  );

  const list = useQuery({
    queryKey: ["hypotheses", statusFilter],
    queryFn: () => api.listHypotheses(statusFilter),
  });
  const suppressedList = useQuery({
    queryKey: ["hypotheses", "suppressed"],
    queryFn: () => api.listHypotheses("suppressed" as never),
    enabled: statusFilter === "active",
  });
  const recheck = useMutation({
    mutationFn: api.recheckHypotheses,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  const realRows = list.data ?? [];
  const { rows, isDemo } = pick(realRows, DEMO.hypotheses);
  const cards: CardData[] = isDemo
    ? (rows as DemoHypothesis[]).map(fromDemo)
    : (rows as Hypothesis[]).map(fromReal);

  const activeCounts = cards.reduce(
    (a, c) => ({ ...a, [c.signal]: (a[c.signal] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  const tabCount = (key: typeof statusFilter) => {
    if (key === "active") return realRows.filter((h) => h.status === "active").length;
    return undefined;
  };

  return (
    <>
      <ScreenHeader
        title={t("hypotheses.heading", "Patterns AI noticed")}
        sub={t(
          "hypotheses.sub",
          "Constellations the engine has matched against curated disease profiles. Discuss with a clinician — these are not diagnoses.",
        )}
        tabs={
          <>
            <Tab
              active={statusFilter === "active"}
              onClick={() => setStatusFilter("active")}
              count={tabCount("active")}
            >
              {t("hypotheses.filter.active", "Active")}
            </Tab>
            <Tab active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              {t("hypotheses.filter.all", "All")}
            </Tab>
            <Tab
              active={statusFilter === "dismissed"}
              onClick={() => setStatusFilter("dismissed")}
              count={0}
            >
              {t("hypotheses.filter.dismissed", "Dismissed")}
            </Tab>
            <Tab
              active={statusFilter === "confirmed"}
              onClick={() => setStatusFilter("confirmed")}
              count={0}
            >
              {t("hypotheses.filter.confirmed", "Evaluated")}
            </Tab>
          </>
        }
        actions={
          <>
            <button
              className="btn ghost sm"
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ display: "inline-flex" }}>{Icons.retry}</span>
              {recheck.isPending
                ? t("hypotheses.checking", "Checking…")
                : t("hypotheses.recheck", "Re-check")}
            </button>
            <button className="btn primary" onClick={() => navigate("/insights")}>
              {t("nav.brief", "Open brief")} →
            </button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 28px" }}>
        {/* Heading row with optional "sample data" marker */}
        {isDemo && (
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span
              className="pill"
              style={{ fontSize: 10.5, height: 20, lineHeight: "20px", padding: "0 8px" }}
            >
              sample data
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {t("hypotheses.demoNotice", "No real hypotheses yet — showing demo data.")}
            </span>
          </div>
        )}

        {/* Signal summary strip */}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}
        >
          {(["strong", "moderate", "weak"] as SignalStrength[]).map((sig) => {
            const s = SIGNAL[sig];
            const count = activeCounts[sig] ?? 0;
            return (
              <div
                key={sig}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: s.bg,
                  border: `1px solid color-mix(in oklch, ${s.bar} 20%, var(--border))`,
                }}
              >
                <div className="k-label" style={{ color: s.fg }}>
                  {s.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 30, fontWeight: 600, color: s.fg, letterSpacing: -0.5 }}>
                    {count}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {count === 1 ? "pattern" : "patterns"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recheck result notice */}
        {recheck.data && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              padding: "8px 12px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            Recheck complete · {recheck.data.user_signals} user signals scanned ·{" "}
            {recheck.data.candidates_considered} candidates considered ·{" "}
            {recheck.data.hypotheses_written} pattern
            {recheck.data.hypotheses_written === 1 ? "" : "s"} updated.
          </div>
        )}

        {/* Card list */}
        {list.isLoading ? (
          <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "32px 0" }}>
            {t("hypotheses.loading", "Loading…")}
          </div>
        ) : cards.length === 0 ? (
          <EmptyState onRecheck={() => recheck.mutate()} pending={recheck.isPending} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {cards.map((c, i) => (
              <HypothesisCard key={c.id} card={c} index={i + 1} />
            ))}
          </div>
        )}

        {/* Suppressed section */}
        {statusFilter === "active" && (suppressedList.data?.length ?? 0) > 0 && (
          <SuppressedSection items={suppressedList.data ?? []} />
        )}
      </div>
    </>
  );
}

/* ─── HypothesisCard ────────────────────────────────────────────────────── */
function HypothesisCard({ card: c, index }: { card: CardData; index: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const s = SIGNAL[c.signal];
  const [expanded, setExpanded] = useState(false);

  const patch = useMutation({
    mutationFn: (body: { status?: string; dismissed_reason?: string }) =>
      api.patchHypothesis(c.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  return (
    <article
      style={{
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-1)",
      }}
    >
      {/* Signal header strip */}
      <div
        style={{
          padding: "12px 20px",
          background: `linear-gradient(90deg, ${s.bg} 0%, transparent 60%)`,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", minWidth: 16 }}>
          {String(index).padStart(2, "0")}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.08,
            padding: "3px 10px",
            borderRadius: 4,
            background: s.bar,
            color: "white",
          }}
        >
          {s.label}
        </span>
        {c.category && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: 0.06,
            }}
          >
            {c.category}
          </span>
        )}
        {c.redFlag && (
          <Pill tone="danger" dot>
            time-sensitive features
          </Pill>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <ScoreGauge value={c.score} />
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
              {c.score.toFixed(2)}
            </div>
            <div className="k-label" style={{ fontSize: 9.5 }}>
              match score
            </div>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: "18px 20px" }}>
        <h3
          style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, letterSpacing: -0.2, display: "flex", alignItems: "center", gap: 8 }}
        >
          {c.disease}
          {c.userConfirmed && (
            <span title={t("hypotheses.confirmedBadgeTooltip") ?? ""} style={{ color: "var(--warn)", fontSize: 16 }}>
              ★
            </span>
          )}
        </h3>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)" }}>
          {c.rationale}
        </p>

        {/* Evidence chips */}
        <EvidenceChips card={c} />

        {/* Suggested next step */}
        {c.suggested && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              display: "flex",
              gap: 10,
            }}
          >
            <span style={{ color: "var(--accent)", flexShrink: 0, display: "inline-flex" }}>
              {Icons.sparkle}
            </span>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <b style={{ color: "var(--ink)" }}>
                {t("hypotheses.suggestedNext", "Suggested next step.")}
              </b>{" "}
              {c.suggested}
            </div>
          </div>
        )}

        {/* Expandable feature breakdown */}
        {expanded && <FeatureBreakdown features={c.features} />}

        {/* Dismissed reason */}
        {c.dismissedReason && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
            {t("hypotheses.dismissedReason", "Dismissed:")} {c.dismissedReason}
          </div>
        )}

        {/* Action row */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? t("hypotheses.hideEvidence", "Hide evidence")
              : t("hypotheses.showEvidence", "Show how this matched")}
          </button>
          {c.sourceUrl && (
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <span style={{ display: "inline-flex" }}>{Icons.ext}</span>
              {t("hypotheses.openReference", "Reference")}
            </a>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {c.status === "active" ? (
              <>
                <button
                  className="btn sm"
                  disabled={c.isDemo || patch.isPending}
                  onClick={() => !c.isDemo && patch.mutate({ status: "confirmed" })}
                  style={{
                    color: "var(--ok)",
                    borderColor: "color-mix(in oklch, var(--ok) 25%, var(--border))",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ display: "inline-flex" }}>{Icons.check}</span>
                  {t("hypotheses.alreadyEvaluated", "Already evaluated")}
                </button>
                <DismissButton
                  disabled={c.isDemo}
                  onDismiss={(reason) =>
                    !c.isDemo && patch.mutate({ status: "dismissed", dismissed_reason: reason })
                  }
                />
              </>
            ) : (
              <button
                className="btn sm"
                disabled={c.isDemo || patch.isPending}
                onClick={() => !c.isDemo && patch.mutate({ status: "active" })}
              >
                {t("hypotheses.reactivate", "Reactivate")}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── ScoreGauge ─────────────────────────────────────────────────────────── */
function ScoreGauge({ value }: { value: number }) {
  const pct = Math.min(1, value);
  const color =
    pct >= 0.7 ? "var(--danger)" : pct >= 0.5 ? "var(--warn)" : "var(--ink-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 80,
          height: 4,
          borderRadius: 999,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

/* ─── EvidenceChips ──────────────────────────────────────────────────────── */
function EvidenceChips({ card: c }: { card: CardData }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const corroborated = new Set(c.corroboratedEntryIds);

  const toggle = useMutation({
    mutationFn: ({ entryId, on }: { entryId: string; on: boolean }) =>
      api.patchHypothesis(
        c.id,
        on ? { corroborate_entry_id: entryId } : { uncorroborate_entry_id: entryId },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  if (c.citedEntries.length === 0 && c.citedLabs.length === 0 && c.citedMeds.length === 0)
    return null;

  return (
    <div
      style={{
        marginTop: 14,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span className="k-label" style={{ marginTop: 4 }}>
        {t("hypotheses.evidence", "Evidence")}
      </span>

      {c.citedEntries.slice(0, 6).map((eid) => {
        const isOn = corroborated.has(eid);
        return (
          <button
            key={eid}
            type="button"
            disabled={c.isDemo}
            onClick={() => !c.isDemo && toggle.mutate({ entryId: eid, on: !isOn })}
            title={
              isOn
                ? (t("hypotheses.corroborated") ?? "")
                : (t("hypotheses.corroborateHint") ?? "")
            }
            className="pill"
            style={{
              background: isOn ? "var(--ok-tint)" : "var(--accent-tint)",
              color: isOn ? "var(--ok)" : "var(--accent-strong)",
              borderColor: isOn
                ? "color-mix(in oklch, var(--ok) 25%, var(--border))"
                : "color-mix(in oklch, var(--accent) 25%, var(--border))",
              cursor: c.isDemo ? "default" : "pointer",
            }}
          >
            <span className="mono" style={{ fontSize: 10 }}>
              {isOn && "✓ "}entry · {eid.split("-")[0]}
            </span>
          </button>
        );
      })}

      {c.citedLabs.slice(0, 4).map((lid) => (
        <span
          key={lid}
          className="pill"
          style={{
            background: "var(--info-tint)",
            color: "var(--info)",
            borderColor: "color-mix(in oklch, var(--info) 25%, var(--border))",
          }}
        >
          <span className="mono" style={{ fontSize: 10 }}>
            lab · {lid.split("-")[0]}
          </span>
        </span>
      ))}

      {c.citedMeds.slice(0, 4).map((mid) => (
        <span
          key={mid}
          className="pill"
          style={{
            background: "oklch(96% 0.025 290)",
            color: "oklch(50% 0.12 290)",
            borderColor: "oklch(85% 0.03 290)",
          }}
        >
          <span className="mono" style={{ fontSize: 10 }}>
            med · {mid.split("-")[0]}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ─── FeatureBreakdown ──────────────────────────────────────────────────── */
function FeatureBreakdown({
  features,
}: {
  features: { signal: string; feature: string; freq: string; sim: number }[];
}) {
  if (!features.length) return null;
  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: "1px dashed var(--border-2)",
        background: "var(--surface-2)",
      }}
    >
      <div className="k-label" style={{ marginBottom: 10 }}>
        How the engine matched
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {features.map((f, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1.4fr 90px 56px 50px",
              gap: 10,
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <div style={{ color: "var(--ink)" }}>{f.signal}</div>
            <div style={{ color: "var(--ink-2)" }}>↳ {f.feature}</div>
            <div>
              <Pill
                tone={
                  f.freq === "obligate"
                    ? "danger"
                    : f.freq === "very_frequent"
                    ? "warn"
                    : "ok"
                }
                dot
              >
                {f.freq.replace("_", " ")}
              </Pill>
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 999,
                background: "var(--surface-3)",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${f.sim * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "var(--accent)",
                }}
              />
            </div>
            <div
              className="mono"
              style={{ fontSize: 11.5, textAlign: "right", color: "var(--ink-2)" }}
            >
              {f.sim.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── DismissButton ──────────────────────────────────────────────────────── */
function DismissButton({
  onDismiss,
  disabled,
}: {
  onDismiss: (reason: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open)
    return (
      <button
        className="btn sm danger"
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
      >
        {t("hypotheses.dismiss", "Dismiss")}
      </button>
    );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("hypotheses.dismissReasonPlaceholder", "Reason (optional)")}
        className="input"
        style={{ fontSize: 12, padding: "4px 8px", height: 28 }}
      />
      <button
        className="btn sm danger"
        onClick={() => {
          onDismiss(reason);
          setOpen(false);
          setReason("");
        }}
      >
        {t("hypotheses.dismissConfirm", "Confirm")}
      </button>
      <button className="btn sm" onClick={() => setOpen(false)}>
        {t("common.cancel", "Cancel")}
      </button>
    </div>
  );
}

/* ─── SuppressedSection ──────────────────────────────────────────────────── */
function SuppressedSection({ items }: { items: Hypothesis[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const reactivate = useMutation({
    mutationFn: (id: string) => api.patchHypothesis(id, { status: "active" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  return (
    <section
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: 16,
        marginTop: 24,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.08,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        {t("hypotheses.suppressedHeading", { count: items.length })}
      </button>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((h) => (
            <div
              key={h.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              <span className="mono" style={{ color: "var(--ink-3)", minWidth: 40 }}>
                {h.signal_strength.slice(0, 4)}
              </span>
              <span style={{ flex: 1, color: "var(--ink)" }}>{h.disease_name}</span>
              <span className="mono" style={{ color: "var(--ink-4)" }}>
                {h.match_score.toFixed(2)}
              </span>
              <button
                className="btn sm"
                disabled={reactivate.isPending}
                onClick={() => reactivate.mutate(h.id)}
                style={{ color: "var(--ok)", borderColor: "color-mix(in oklch, var(--ok) 25%, var(--border))" }}
              >
                {t("hypotheses.reactivate", "Reactivate")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── EmptyState ─────────────────────────────────────────────────────────── */
function EmptyState({ onRecheck, pending }: { onRecheck: () => void; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        textAlign: "center",
        padding: "64px 24px",
        color: "var(--ink-3)",
      }}
    >
      <div style={{ display: "inline-flex", marginBottom: 12 }}>{Icons.patterns}</div>
      <p style={{ fontSize: 13.5, maxWidth: 380, margin: "0 auto 16px" }}>
        {t("hypotheses.empty", "No patterns yet. Run a re-check to let the AI engine scan your entries.")}
      </p>
      <button
        className="btn primary"
        disabled={pending}
        onClick={onRecheck}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ display: "inline-flex" }}>{Icons.retry}</span>
        {pending
          ? t("hypotheses.checking", "Checking…")
          : t("hypotheses.recheck", "Re-check now")}
      </button>
    </div>
  );
}
