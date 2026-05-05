import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

export default function InsightsPage() {
  const { t } = useTranslation();
  const [enrich, setEnrich] = useState(false);

  const generate = useMutation({
    mutationFn: () => api.generateBrief({ enrich }),
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ← {t("nav.timeline")}
        </Link>
        <h1 className="text-lg font-semibold">{t("insights.heading")}</h1>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/hypotheses" className="text-sm text-ink/60 hover:text-ink">
            {t("nav.hypotheses")}
          </Link>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-200/95">
          {t("insights.disclaimer")}
        </div>

        <div className="bg-ink/5 border border-ink/10 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md text-sm font-medium"
          >
            {generate.isPending ? t("insights.generating") : t("insights.generate")}
          </button>
          <a
            href={api.briefHtmlUrl({ enrich })}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md border border-ink/20 hover:bg-ink/5 text-sm"
          >
            {t("insights.printable")}
          </a>
          <label className="flex items-center gap-2 text-sm text-ink/65">
            <input
              type="checkbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
            />
            {t("insights.enrich")}
          </label>
        </div>

        {generate.data && (
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
            <aside className="space-y-2 text-xs text-ink/70">
              <div className="bg-ink/5 rounded p-3">
                <div className="text-[10px] uppercase text-ink/45">{t("insights.stats.entries")}</div>
                <div className="text-2xl font-semibold text-ink">{generate.data.stats.entries}</div>
              </div>
              <div className="bg-ink/5 rounded p-3">
                <div className="text-[10px] uppercase text-ink/45">{t("insights.stats.documents")}</div>
                <div className="text-2xl font-semibold text-ink">{generate.data.stats.documents}</div>
              </div>
              <div className="bg-ink/5 rounded p-3">
                <div className="text-[10px] uppercase text-ink/45">{t("insights.stats.abnLabs")}</div>
                <div className="text-2xl font-semibold text-ink">{generate.data.stats.abnormal_labs}</div>
              </div>
              <div className="bg-ink/5 rounded p-3">
                <div className="text-[10px] uppercase text-ink/45">{t("insights.stats.medications")}</div>
                <div className="text-2xl font-semibold text-ink">{generate.data.stats.medications}</div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/25 rounded p-3">
                <div className="text-[10px] uppercase text-amber-200/80">
                  {t("insights.stats.hypotheses")}
                </div>
                <div className="text-2xl font-semibold text-amber-200">
                  {generate.data.stats.hypotheses}
                </div>
              </div>
            </aside>
            <pre className="bg-ink/5 border border-ink/10 rounded p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed overflow-auto">
              {generate.data.markdown}
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
