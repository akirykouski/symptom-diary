import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { LabPoint } from "../api/client";
import { api } from "../api/client";

export default function LabsPage() {
  const { t } = useTranslation();
  const tests = useQuery({ queryKey: ["labs", "tests"], queryFn: api.labsTests });
  const [selected, setSelected] = useState<string | null>(null);

  const series = useQuery({
    queryKey: ["labs", "timeline", selected],
    queryFn: () => api.labsTimeline(selected!),
    enabled: selected != null,
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ← {t("nav.timeline")}
        </Link>
        <h1 className="text-lg font-semibold">{t("labs.heading")}</h1>
        <div className="ml-auto flex gap-3">
          <Link to="/documents" className="text-sm text-ink/60 hover:text-ink">
            {t("labs.documentsLink")}
          </Link>
        </div>
      </header>
      <main className="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
        <aside className="border-r border-ink/10 overflow-y-auto">
          {tests.isLoading ? (
            <div className="p-4 text-ink/60">{t("labs.loading")}</div>
          ) : tests.data && tests.data.length === 0 ? (
            <div className="p-4 text-ink/60">{t("labs.empty")}</div>
          ) : (
            <ul>
              {(tests.data ?? []).map((it) => (
                <li key={it.test_name}>
                  <button
                    onClick={() => setSelected(it.test_name)}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-ink/5 ${
                      selected === it.test_name ? "bg-accent/15" : ""
                    }`}
                  >
                    <span>{it.test_name}</span>
                    <span className="text-xs text-ink/50">{it.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="overflow-y-auto p-6">
          {selected == null ? (
            <div className="text-ink/50">{t("labs.pickPrompt")}</div>
          ) : series.isLoading ? (
            <div className="text-ink/60">{t("labs.loading")}</div>
          ) : (
            <LabSeriesView name={selected} points={series.data?.points ?? []} />
          )}
        </section>
      </main>
    </div>
  );
}

function LabSeriesView({ name, points }: { name: string; points: LabPoint[] }) {
  const { t } = useTranslation();
  if (points.length === 0) {
    return <div className="text-ink/60">{t("labs.empty")}</div>;
  }

  const numeric = points.filter(
    (p): p is LabPoint & { value_numeric: number } => typeof p.value_numeric === "number",
  );
  let trend: { min: number; max: number; range: number } | null = null;
  if (numeric.length > 0) {
    const min = Math.min(...numeric.map((p) => p.value_numeric));
    const max = Math.max(...numeric.map((p) => p.value_numeric));
    trend = { min, max, range: max - min };
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{name}</h2>
      <DisclaimerBanner />
      {trend && (
        <div className="text-xs text-ink/60 grid grid-cols-3 gap-2 max-w-md">
          <Stat label={t("labs.stats.min")} value={trend.min.toFixed(2)} />
          <Stat label={t("labs.stats.max")} value={trend.max.toFixed(2)} />
          <Stat label={t("labs.stats.range")} value={trend.range.toFixed(2)} />
        </div>
      )}
      <ol className="space-y-2">
        {points.map((p, i) => (
          <li
            key={i}
            className="flex items-start gap-3 border-l-2 border-accent/30 pl-3 py-1"
          >
            <span className="text-xs text-ink/50 w-24 shrink-0">
              {p.measured_at?.slice(0, 10) ?? "—"}
            </span>
            <span className="text-sm">
              {p.value_numeric ?? p.value_text ?? "—"}
              {p.unit && <span className="text-ink/50"> {p.unit}</span>}
            </span>
            <span className="text-xs">
              {p.is_abnormal === 1 && (
                <span className="text-red-300">↑ high</span>
              )}
              {p.is_abnormal === -1 && (
                <span className="text-amber-300">↓ low</span>
              )}
              {p.is_abnormal === 0 && (
                <span className="text-emerald-300">in range</span>
              )}
            </span>
            <span className="text-xs text-ink/40">
              {p.reference_low ?? "—"} – {p.reference_high ?? "—"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink/5 rounded p-2">
      <div className="text-[10px] uppercase text-ink/50">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function DisclaimerBanner() {
  const { t } = useTranslation();
  return (
    <div className="text-[11px] bg-amber-500/10 border border-amber-500/25 text-amber-200 rounded px-3 py-2">
      {t("documents.disclaimer")}
    </div>
  );
}
