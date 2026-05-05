import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api, AskCitation, AskResponse } from "../api/client";
import QrShareModal from "../components/QrShareModal";

export default function InsightsPage() {
  const { t } = useTranslation();
  const [enrich, setEnrich] = useState(false);
  const [showQr, setShowQr] = useState(false);

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
      <main className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-200/95">
          {t("insights.disclaimer")}
        </div>

        <AskPanel />

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-ink/90">
            {t("insights.heading")}
          </h2>
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
            <a
              href={api.briefPdfUrl({ enrich })}
              download
              className="px-4 py-2 rounded-md border border-ink/20 hover:bg-ink/5 text-sm"
              title={t("insights.pdfHint") ?? ""}
            >
              {t("insights.downloadPdf")}
            </a>
            <button
              onClick={() => setShowQr(true)}
              className="px-4 py-2 rounded-md border border-accent/40 hover:bg-accent/10 text-sm text-accent"
              type="button"
            >
              {t("qr.openButton")}
            </button>
            <label className="flex items-center gap-2 text-sm text-ink/65">
              <input
                type="checkbox"
                checked={enrich}
                onChange={(e) => setEnrich(e.target.checked)}
              />
              {t("insights.enrich")}
            </label>
          </div>

          <BundleExportPanel />
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
        </section>
      </main>
      {showQr && <QrShareModal onClose={() => setShowQr(false)} />}
    </div>
  );
}

function BundleExportPanel() {
  const { t } = useTranslation();
  return (
    <div className="bg-ink/3 border border-ink/10 rounded-lg p-4 space-y-2">
      <div className="text-sm font-medium text-ink/85">{t("bundle.exportHeading")}</div>
      <p className="text-xs text-ink/55 max-w-2xl">{t("bundle.exportIntro")}</p>
      <a
        href={api.bundleExportUrl()}
        download
        className="inline-block px-3 py-1.5 rounded-md border border-ink/20 hover:bg-ink/5 text-xs"
      >
        {t("bundle.exportButton")}
      </a>
    </div>
  );
}

function AskPanel() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [openCitation, setOpenCitation] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (q: string) => api.askInsight({ question: q }),
  });

  const examples = useMemo(() => {
    const list = t("ask.exampleList", { returnObjects: true }) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  }, [t]);

  const submit = () => {
    const q = question.trim();
    if (!q) return;
    setOpenCitation(null);
    ask.mutate(q);
  };

  const result = ask.data;

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-ink/90">{t("ask.heading")}</h2>
        <p className="text-xs text-ink/55 max-w-2xl">{t("ask.intro")}</p>
      </header>

      <div className="bg-ink/5 border border-ink/10 rounded-lg p-4 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder={t("ask.placeholder") ?? ""}
          rows={3}
          className="w-full bg-bg/40 border border-ink/15 rounded-md p-2 text-sm font-sans resize-none focus:outline-none focus:border-accent/60"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={submit}
            disabled={ask.isPending || !question.trim()}
            className="bg-accent hover:bg-accent/90 disabled:opacity-40 px-4 py-2 rounded-md text-sm font-medium"
          >
            {ask.isPending ? t("ask.submitting") : t("ask.submit")}
          </button>
          <span className="text-[11px] text-ink/40">⌘/Ctrl + ↵</span>
          {examples.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-ink/45 mr-1">{t("ask.examples")}:</span>
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuestion(ex)}
                  className="text-[11px] px-2 py-1 rounded-full bg-ink/5 border border-ink/10 hover:bg-ink/10 text-ink/70"
                  type="button"
                >
                  {ex.length > 48 ? `${ex.slice(0, 47)}…` : ex}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {ask.isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {t("ask.errorGeneric")}
        </div>
      )}

      {result && <AskAnswer result={result} openCitation={openCitation} setOpenCitation={setOpenCitation} />}
    </section>
  );
}

function AskAnswer({
  result,
  openCitation,
  setOpenCitation,
}: {
  result: AskResponse;
  openCitation: string | null;
  setOpenCitation: (v: string | null) => void;
}) {
  const { t } = useTranslation();
  const citationByPrefix = useMemo(() => {
    const m = new Map<string, AskCitation>();
    for (const c of result.citations) m.set(c.prefix, c);
    return m;
  }, [result.citations]);

  const refusal = result.refusal;
  const isRefusal = refusal !== null;

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        isRefusal
          ? "border-rose-500/40 bg-rose-500/8"
          : "border-ink/15 bg-ink/3"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={`px-2 py-0.5 rounded-full font-medium ${
            isRefusal
              ? "bg-rose-500/20 text-rose-200"
              : "bg-emerald-500/15 text-emerald-200"
          }`}
        >
          {isRefusal ? `${t("ask.refusalBadge")} · ${refusal!.category}` : t("ask.answer")}
        </span>
        {result.used_fallback && (
          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200">
            {t("ask.fallbackBadge")}
          </span>
        )}
      </div>

      <div className="text-sm leading-relaxed text-ink/95 whitespace-pre-wrap">
        {renderWithCitations(result.answer_md, citationByPrefix, (p) =>
          setOpenCitation(openCitation === p ? null : p),
        )}
      </div>

      {openCitation && citationByPrefix.has(openCitation) && (
        <CitationCard citation={citationByPrefix.get(openCitation)!} onClose={() => setOpenCitation(null)} />
      )}

      {!isRefusal && result.citations.length > 0 && (
        <div className="pt-2 border-t border-ink/10 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-ink/45">
            {t("ask.citations")}
          </div>
          <ul className="space-y-1.5">
            {result.citations.map((c) => (
              <li key={c.entry_id}>
                <button
                  onClick={() => setOpenCitation(openCitation === c.prefix ? null : c.prefix)}
                  className="text-left w-full text-xs bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded px-3 py-2"
                >
                  <span className="font-mono text-ink/55 mr-2">[entry-{c.prefix}]</span>
                  <span className="text-ink/50 mr-2">{c.ts_event.slice(0, 10)}</span>
                  <span className="text-ink/85">{c.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CitationCard({ citation, onClose }: { citation: AskCitation; onClose: () => void }) {
  return (
    <div className="rounded-md border border-accent/40 bg-accent/8 p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-ink/55 font-mono">
          [entry-{citation.prefix}] · {citation.ts_event.slice(0, 10)}
        </span>
        <button
          onClick={onClose}
          className="text-ink/50 hover:text-ink/80"
          type="button"
          aria-label="close"
        >
          ✕
        </button>
      </div>
      <p className="text-ink/85 whitespace-pre-wrap">{citation.snippet}</p>
    </div>
  );
}

const CITATION_RE = /\[entry-([a-f0-9]{4,12})\]/gi;

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
      <button
        key={`pill-${key++}`}
        type="button"
        onClick={() => known && onPillClick(prefix)}
        title={byPrefix.get(prefix)?.snippet ?? ""}
        className={`inline-flex items-center align-baseline mx-0.5 px-1.5 py-0 rounded text-[11px] font-mono leading-snug ${
          known
            ? "bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer"
            : "bg-ink/10 text-ink/50"
        }`}
      >
        entry-{prefix}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
