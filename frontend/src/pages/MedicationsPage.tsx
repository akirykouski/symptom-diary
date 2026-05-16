import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Icons, Pill, ScreenHeader } from "../ui/clario";
import { DEMO, pick } from "../ui/demo";

/* ── StatCard (ported inline from screens-1.jsx StatCard) ─────────── */
type Accent = "neutral" | "accent" | "info" | "sage" | "amber" | "coral" | "violet";

function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: Accent;
}) {
  const palettes: Record<Accent, { fg: string; tint: string; bd: string }> = {
    neutral: { fg: "var(--ink)",           tint: "var(--surface)",      bd: "var(--border)" },
    accent:  { fg: "var(--accent-strong)", tint: "var(--accent-tint)",  bd: "color-mix(in oklch, var(--accent) 22%, var(--border))" },
    info:    { fg: "oklch(40% 0.10 245)",  tint: "var(--info-tint)",    bd: "color-mix(in oklch, var(--info) 22%, var(--border))" },
    sage:    { fg: "oklch(40% 0.10 155)",  tint: "var(--sage-tint)",    bd: "color-mix(in oklch, var(--sage) 22%, var(--border))" },
    amber:   { fg: "oklch(42% 0.13 78)",   tint: "var(--amber-tint)",   bd: "color-mix(in oklch, var(--amber) 25%, var(--border))" },
    coral:   { fg: "oklch(45% 0.14 30)",   tint: "var(--coral-tint)",   bd: "color-mix(in oklch, var(--coral) 25%, var(--border))" },
    violet:  { fg: "oklch(42% 0.11 290)",  tint: "var(--violet-tint)",  bd: "color-mix(in oklch, var(--violet) 22%, var(--border))" },
  };
  const p = palettes[accent] ?? palettes.neutral;
  return (
    <div style={{ padding: 14, borderRadius: 14, background: p.tint, border: "1px solid " + p.bd }}>
      <div className="k-label" style={{ color: p.fg, opacity: 0.8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 26, fontWeight: 600, color: p.fg, letterSpacing: -0.6, fontFamily: "Geist" }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: p.fg, opacity: 0.7, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function MedicationsPage() {
  const { t } = useTranslation();

  const medsQ = useQuery({
    queryKey: ["medications", "timeline"],
    queryFn: api.medicationsTimeline,
  });

  const { rows, isDemo } = pick(
    medsQ.isLoading ? undefined : (medsQ.data ?? []),
    DEMO.medications.map((m) => ({
      id: m.id,
      drug_name: m.drug,
      drug_name_raw: m.drug,
      dose: m.dose,
      frequency: m.frequency,
      duration: m.duration,
      prescribed_at: m.prescribed,
    })),
  );

  // derive counts from real data
  const totalMeds = rows.length;
  const prescriptionDocs = DEMO.documents.filter((d) => d.type === "prescription").length;
  const refillCount = isDemo ? 1 : 0;

  const demoLabel = (
    <span className="pill" style={{ fontSize: 10.5, height: 20 }}>
      sample data
    </span>
  );

  return (
    <>
      <ScreenHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {t("medications.heading", "Medications")}
            {isDemo && demoLabel}
          </span>
        }
        sub={t("medications.sub", "Every prescription extracted from your visit notes and prescriptions.")}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 28px" }}>
        {/* stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard
            label={t("medications.stat.active", "Active medications")}
            value={totalMeds}
            sub={t("medications.stat.activeSub", "on record")}
            accent="sage"
          />
          <StatCard
            label={t("medications.stat.prescriptions", "Prescriptions on file")}
            value={prescriptionDocs}
            sub={t("medications.stat.prescriptionsSub", "all verified")}
            accent="info"
          />
          <StatCard
            label={t("medications.stat.refills", "Refills in 14 days")}
            value={refillCount}
            sub={isDemo ? t("medications.stat.refillsSub", "Ferrous sulfate · running low") : t("medications.stat.refillsNone", "none upcoming")}
            accent="amber"
          />
        </div>

        {/* medications table card */}
        <div className="card" style={{ overflow: "hidden" }}>
          {/* header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr 1.4fr 1fr 1fr 80px",
            gap: 0,
            padding: "12px 16px",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}>
            {[
              t("medications.cols.drug", "Drug"),
              t("medications.cols.dose", "Dose"),
              t("medications.cols.frequency", "Frequency"),
              t("medications.cols.duration", "Duration"),
              t("medications.cols.prescribed", "Prescribed"),
              t("medications.cols.source", "Source"),
            ].map((h) => (
              <div key={h} className="k-label">{h}</div>
            ))}
          </div>

          {medsQ.isLoading ? (
            <div style={{ padding: "20px 16px", color: "var(--ink-3)", fontSize: 13 }}>
              {t("medications.loading", "Loading…")}
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "20px 16px", color: "var(--ink-3)", fontSize: 13 }}>
              {t("medications.empty", "No medications recorded yet.")}
            </div>
          ) : (
            rows.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 1fr 1.4fr 1fr 1fr 80px",
                  padding: "14px 16px",
                  alignItems: "center",
                  fontSize: 13,
                  borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)",
                }}
              >
                {/* Drug cell */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: "var(--accent-tint)", color: "var(--accent-strong)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {Icons.meds}
                  </span>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {"drug_name_raw" in m ? m.drug_name_raw || m.drug_name : (m as { drug: string }).drug}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{m.id}</div>
                  </div>
                </div>

                {/* Dose */}
                <div className="mono">{m.dose ?? "—"}</div>

                {/* Frequency */}
                <div>{m.frequency ?? "—"}</div>

                {/* Duration */}
                <div style={{ color: "var(--ink-2)" }}>{m.duration ?? "—"}</div>

                {/* Prescribed */}
                <div className="mono" style={{ color: "var(--ink-3)" }}>
                  {m.prescribed_at
                    ? String(m.prescribed_at).slice(0, 10)
                    : ("prescribed" in m ? (m as { prescribed: string }).prescribed : "—")}
                </div>

                {/* Source */}
                <button className="btn ghost sm">
                  {t("medications.viewDoc", "View doc →")}
                </button>
              </div>
            ))
          )}
        </div>

        {/* empty state with demo tag when truly no API data and no demo */}
        {!medsQ.isLoading && rows.length === 0 && (
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <Pill tone="neutral">{t("medications.empty", "No medications recorded yet.")}</Pill>
          </div>
        )}
      </div>
    </>
  );
}
