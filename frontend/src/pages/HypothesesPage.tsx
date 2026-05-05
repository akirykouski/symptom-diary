import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Hypothesis, SignalStrength } from "../api/client";
import { api } from "../api/client";

const SIGNAL_TONE: Record<SignalStrength, { ring: string; bg: string; bar: string; label: string }> = {
  strong: {
    ring: "ring-rose-500/40",
    bg: "from-rose-500/12 via-rose-500/6 to-transparent",
    bar: "bg-rose-500",
    label: "STRONG SIGNAL",
  },
  moderate: {
    ring: "ring-amber-500/40",
    bg: "from-amber-500/12 via-amber-500/6 to-transparent",
    bar: "bg-amber-500",
    label: "MODERATE PATTERN",
  },
  weak: {
    ring: "ring-slate-500/30",
    bg: "from-slate-500/8 via-slate-500/4 to-transparent",
    bar: "bg-slate-500",
    label: "WEAK SIGNAL",
  },
};

export default function HypothesesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "dismissed" | "confirmed">(
    "active",
  );

  const list = useQuery({
    queryKey: ["hypotheses", statusFilter],
    queryFn: () => api.listHypotheses(statusFilter),
  });
  const recheck = useMutation({
    mutationFn: api.recheckHypotheses,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  const data = list.data ?? [];
  const counts = {
    strong: data.filter((h) => h.signal_strength === "strong").length,
    moderate: data.filter((h) => h.signal_strength === "moderate").length,
    weak: data.filter((h) => h.signal_strength === "weak").length,
  };

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ← {t("nav.timeline")}
        </Link>
        <h1 className="text-lg font-semibold">{t("hypotheses.heading")}</h1>
        <div className="ml-4 flex gap-1.5">
          {(["active", "all", "dismissed", "confirmed"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={`text-xs px-2 py-1 rounded ${
                statusFilter === k ? "bg-accent/20 text-ink" : "text-ink/55 hover:text-ink"
              }`}
            >
              {t(`hypotheses.filter.${k}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/insights" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.brief")}
          </Link>
          <button
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
            className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-3 py-1.5 rounded-md text-sm font-medium"
          >
            {recheck.isPending ? t("hypotheses.checking") : t("hypotheses.recheck")}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        <DisclaimerHero />
        <SignalStrip counts={counts} />

        {recheck.data && (
          <div className="text-xs text-ink/55 px-3 py-2 bg-ink/5 rounded">
            Recheck complete · {recheck.data.user_signals} user signals scanned ·{" "}
            {recheck.data.candidates_considered} candidates considered ·{" "}
            {recheck.data.hypotheses_written} pattern{recheck.data.hypotheses_written === 1 ? "" : "s"} updated.
          </div>
        )}

        {list.isLoading ? (
          <div className="text-ink/60">{t("hypotheses.loading")}</div>
        ) : data.length === 0 ? (
          <EmptyState onRecheck={() => recheck.mutate()} pending={recheck.isPending} />
        ) : (
          <ol className="space-y-4">
            {data.map((h, i) => (
              <HypothesisCard key={h.id} h={h} index={i + 1} />
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}

function SignalStrip({ counts }: { counts: { strong: number; moderate: number; weak: number } }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <SignalSummary label="Strong signals" tone="strong" count={counts.strong} />
      <SignalSummary label="Moderate patterns" tone="moderate" count={counts.moderate} />
      <SignalSummary label="Weak signals" tone="weak" count={counts.weak} />
    </div>
  );
}

function SignalSummary({
  label,
  tone,
  count,
}: {
  label: string;
  tone: SignalStrength;
  count: number;
}) {
  const palette = SIGNAL_TONE[tone];
  return (
    <div className={`bg-gradient-to-br ${palette.bg} ring-1 ${palette.ring} rounded-lg px-4 py-3`}>
      <div className="text-[11px] uppercase tracking-wide text-ink/55">{label}</div>
      <div className="text-3xl font-semibold mt-1">{count}</div>
    </div>
  );
}

function HypothesisCard({ h, index }: { h: Hypothesis; index: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const palette = SIGNAL_TONE[h.signal_strength];
  const [showDetails, setShowDetails] = useState(false);

  const patch = useMutation({
    mutationFn: (body: { status?: string; dismissed_reason?: string }) =>
      api.patchHypothesis(h.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hypotheses"] }),
  });

  return (
    <li
      className={`relative overflow-hidden rounded-xl ring-1 ${palette.ring} bg-gradient-to-br ${palette.bg}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="p-5 pl-7 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="text-[10px] font-mono text-ink/40">{String(index).padStart(2, "0")}</span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded text-white ${palette.bar}`}
              >
                {palette.label}
              </span>
              {h.category && (
                <span className="text-[10px] uppercase tracking-wide text-ink/45">
                  {h.category}
                </span>
              )}
              {h.red_flag === 1 && (
                <span className="text-[10px] uppercase tracking-wide text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded">
                  time-sensitive features
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold">{h.disease_name}</h2>
          </div>
          <ScoreBadge score={h.match_score} />
        </div>

        <p className="text-sm text-ink/85 leading-relaxed">{h.rationale_md}</p>

        <EvidenceChips h={h} />

        {showDetails && <FeatureBreakdown h={h} />}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="px-2.5 py-1 rounded border border-ink/15 hover:bg-ink/5"
          >
            {showDetails ? t("hypotheses.hideEvidence") : t("hypotheses.showEvidence")}
          </button>
          <a
            href={h.source_url}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1 rounded border border-ink/15 hover:bg-ink/5 text-ink/70"
          >
            {t("hypotheses.openReference")} ↗
          </a>
          <div className="ml-auto flex gap-2">
            {h.status === "active" ? (
              <>
                <button
                  onClick={() => patch.mutate({ status: "confirmed" })}
                  className="px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                >
                  {t("hypotheses.alreadyEvaluated")}
                </button>
                <DismissButton onDismiss={(reason) => patch.mutate({ status: "dismissed", dismissed_reason: reason })} />
              </>
            ) : (
              <button
                onClick={() => patch.mutate({ status: "active" })}
                className="px-2.5 py-1 rounded border border-ink/20 text-ink/65 hover:bg-ink/5"
              >
                {t("hypotheses.reactivate")}
              </button>
            )}
          </div>
        </div>

        {h.suggested_actions_md && (
          <div className="text-xs bg-canvas/40 border border-ink/10 rounded p-3 text-ink/75 leading-relaxed">
            <span className="font-semibold text-ink/85">
              {t("hypotheses.suggestedNext")}{" "}
            </span>
            {h.suggested_actions_md}
          </div>
        )}

        {h.dismissed_reason && (
          <div className="text-xs text-ink/55 italic">
            Dismissed reason: {h.dismissed_reason}
          </div>
        )}
      </div>
    </li>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="text-right text-[11px] text-ink/55">
      <div className="font-mono text-base text-ink/85">{score.toFixed(2)}</div>
      <div>match score</div>
    </div>
  );
}

function EvidenceChips({ h }: { h: Hypothesis }) {
  const { t } = useTranslation();
  const entries = h.cited_entry_ids;
  const labs = h.cited_lab_value_ids;
  const meds = h.cited_medication_ids;
  if (entries.length === 0 && labs.length === 0 && meds.length === 0) return null;
  return (
    <div className="text-xs text-ink/65 flex flex-wrap gap-1.5">
      <span className="text-ink/45 mr-1">{t("hypotheses.evidence")}</span>
      {entries.slice(0, 6).map((eid) => (
        <span
          key={eid}
          className="bg-ink/5 border border-ink/15 px-2 py-0.5 rounded font-mono"
          title={eid}
        >
          entry · {eid.split("-")[0]}
        </span>
      ))}
      {labs.slice(0, 4).map((lid) => (
        <span
          key={lid}
          className="bg-amber-500/10 border border-amber-500/25 text-amber-200 px-2 py-0.5 rounded font-mono"
          title={lid}
        >
          lab · {lid.split("-")[0]}
        </span>
      ))}
      {meds.slice(0, 4).map((mid) => (
        <span
          key={mid}
          className="bg-violet-500/10 border border-violet-500/25 text-violet-200 px-2 py-0.5 rounded font-mono"
          title={mid}
        >
          med · {mid.split("-")[0]}
        </span>
      ))}
    </div>
  );
}

function FeatureBreakdown({ h }: { h: Hypothesis }) {
  if (!h.matched_features?.length) return null;
  return (
    <div className="bg-canvas/40 border border-ink/10 rounded p-3 text-xs space-y-1.5">
      <div className="text-ink/55 uppercase text-[10px] tracking-wide">
        How the engine matched
      </div>
      {h.matched_features.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-32 truncate text-ink/65">{m.matched_signal}</div>
          <div className="text-ink/35">→</div>
          <div className="flex-1 truncate">{m.feature_name}</div>
          <FrequencyDot freq={m.frequency_class} />
          <div className="font-mono text-ink/55 w-12 text-right">
            {m.similarity.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function FrequencyDot({ freq }: { freq: string }) {
  const color =
    freq === "obligate"
      ? "bg-rose-400"
      : freq === "very_frequent"
      ? "bg-amber-400"
      : freq === "frequent"
      ? "bg-emerald-400"
      : "bg-slate-400";
  return (
    <span
      title={freq.replace("_", " ")}
      className={`inline-block w-2 h-2 rounded-full ${color}`}
    />
  );
}

function DismissButton({ onDismiss }: { onDismiss: (reason: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
      >
        {t("hypotheses.dismiss")}
      </button>
    );
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("hypotheses.dismissReasonPlaceholder")}
        className="px-2 py-1 rounded bg-canvas border border-ink/20 text-xs"
      />
      <button
        onClick={() => onDismiss(reason)}
        className="px-2 py-1 rounded bg-rose-500/15 text-rose-200 border border-rose-500/30"
      >
        {t("hypotheses.dismissConfirm")}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="px-2 py-1 rounded text-ink/45 hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

function DisclaimerHero() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-200/95 leading-relaxed">
      <div className="font-semibold text-amber-100 mb-1">{t("hypotheses.disclaimerHeading")}</div>
      <p>{t("hypotheses.disclaimerBody")}</p>
    </div>
  );
}

function EmptyState({ onRecheck, pending }: { onRecheck: () => void; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-16 px-6 text-ink/60">
      <div className="text-3xl mb-3">🔍</div>
      <p className="max-w-md mx-auto">{t("hypotheses.empty")}</p>
      <button
        onClick={onRecheck}
        disabled={pending}
        className="mt-4 bg-accent hover:bg-accent/90 disabled:opacity-50 px-3 py-1.5 rounded-md text-sm font-medium"
      >
        {pending ? t("hypotheses.checking") : t("hypotheses.recheck")}
      </button>
    </div>
  );
}
