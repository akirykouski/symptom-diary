import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentRecord } from "../api/client";
import { api } from "../api/client";

const DOC_TYPES = [
  "visit_note",
  "lab_result",
  "prescription",
  "imaging",
  "discharge",
  "referral",
  "other",
];

export default function DocumentsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);

  const docs = useQuery({
    queryKey: ["documents", { type: filter }],
    queryFn: () => api.listDocuments(filter ? { type: filter } : undefined),
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ← {t("nav.timeline")}
        </Link>
        <h1 className="text-lg font-semibold">{t("documents.heading")}</h1>
        <div className="flex items-center gap-2 ml-4 flex-wrap">
          <button
            onClick={() => setFilter(undefined)}
            className={`text-sm px-2 py-1 rounded ${
              filter === undefined ? "bg-accent/20 text-ink" : "text-ink/60 hover:text-ink"
            }`}
          >
            {t("documents.all")}
          </button>
          {DOC_TYPES.map((dt) => (
            <button
              key={dt}
              onClick={() => setFilter(dt)}
              className={`text-sm px-2 py-1 rounded ${
                filter === dt ? "bg-accent/20 text-ink" : "text-ink/60 hover:text-ink"
              }`}
            >
              {t(`documents.types.${dt}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-3">
          <Link to="/labs" className="text-sm text-ink/60 hover:text-ink">
            {t("documents.labsLink")}
          </Link>
          <Link to="/medications" className="text-sm text-ink/60 hover:text-ink">
            {t("documents.medsLink")}
          </Link>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        {docs.isLoading ? (
          <div className="text-ink/60">{t("documents.loading")}</div>
        ) : docs.data && docs.data.length === 0 ? (
          <div className="text-ink/60">{t("documents.empty")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(docs.data ?? []).map((d) => (
              <DocumentCard key={d.id} doc={d} onSelect={() => setSelected(d)} />
            ))}
          </div>
        )}
      </main>
      {selected && (
        <DocumentDetailModal doc={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function DocumentCard({
  doc,
  onSelect,
}: {
  doc: DocumentRecord;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onSelect}
      className="text-left bg-ink/5 border border-ink/10 hover:border-accent/40 rounded-lg p-4 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-accent">
          {t(`documents.types.${doc.doc_type}`)}
        </span>
        {doc.user_verified === 1 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
            {t("documents.verified")}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
            {t("documents.aiOnly")}
          </span>
        )}
      </div>
      <div className="text-sm font-medium">
        {doc.clinician_name ?? t("documents.unknownClinician")}
        {doc.clinician_specialty && (
          <span className="text-ink/50"> · {doc.clinician_specialty}</span>
        )}
      </div>
      <div className="text-xs text-ink/50 mt-1">
        {doc.doc_date ?? doc.created_at.slice(0, 10)}
        {doc.facility && <span> · {doc.facility}</span>}
      </div>
      {doc.findings_md && (
        <div className="text-xs text-ink/70 mt-2 line-clamp-3">
          {doc.findings_md}
        </div>
      )}
      <div className="flex gap-2 mt-3 text-[11px] text-ink/50">
        {doc.lab_values.length > 0 && (
          <span>{doc.lab_values.length} labs</span>
        )}
        {doc.medications.length > 0 && (
          <span>{doc.medications.length} meds</span>
        )}
      </div>
    </button>
  );
}

function DocumentDetailModal({
  doc,
  onClose,
}: {
  doc: DocumentRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DocumentRecord>(doc);

  const save = useMutation({
    mutationFn: (body: Partial<DocumentRecord>) => api.patchDocument(doc.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-ink/20 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t(`documents.types.${doc.doc_type}`)}
          </h2>
          <a
            href={api.mediaUrl(doc.media_id)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent hover:underline"
          >
            {t("documents.openOriginal")}
          </a>
        </div>

        <DisclaimerBanner />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label={t("documents.fields.docDate")} value={draft.doc_date}
            onChange={(v) => setDraft({ ...draft, doc_date: v })} />
          <Field label={t("documents.fields.clinician")} value={draft.clinician_name}
            onChange={(v) => setDraft({ ...draft, clinician_name: v })} />
          <Field label={t("documents.fields.specialty")} value={draft.clinician_specialty}
            onChange={(v) => setDraft({ ...draft, clinician_specialty: v })} />
          <Field label={t("documents.fields.facility")} value={draft.facility}
            onChange={(v) => setDraft({ ...draft, facility: v })} />
        </div>

        <FieldArea label={t("documents.fields.findings")} value={draft.findings_md}
          onChange={(v) => setDraft({ ...draft, findings_md: v })} />
        <FieldArea label={t("documents.fields.recommendations")}
          value={draft.recommendations_md}
          onChange={(v) => setDraft({ ...draft, recommendations_md: v })} />

        {doc.lab_values.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">{t("documents.labs")}</h3>
            <table className="w-full text-xs">
              <thead className="text-ink/50">
                <tr>
                  <th className="text-left py-1">{t("documents.labCols.test")}</th>
                  <th className="text-left">{t("documents.labCols.value")}</th>
                  <th className="text-left">{t("documents.labCols.unit")}</th>
                  <th className="text-left">{t("documents.labCols.range")}</th>
                  <th className="text-left">{t("documents.labCols.flag")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.lab_values.map((lv) => (
                  <tr key={lv.id} className="border-t border-ink/10">
                    <td className="py-1">{lv.test_name_raw}</td>
                    <td>{lv.value_numeric ?? lv.value_text ?? "—"}</td>
                    <td>{lv.unit ?? "—"}</td>
                    <td>
                      {lv.reference_low ?? "—"} – {lv.reference_high ?? "—"}
                    </td>
                    <td>
                      <AbnormalFlag flag={lv.is_abnormal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {doc.medications.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">{t("documents.medications")}</h3>
            <ul className="text-xs space-y-1">
              {doc.medications.map((m) => (
                <li key={m.id} className="border-l-2 border-accent/30 pl-2">
                  <span className="font-medium">{m.drug_name_raw}</span>
                  {m.dose && <span className="text-ink/60"> · {m.dose}</span>}
                  {m.frequency && <span className="text-ink/60"> · {m.frequency}</span>}
                  {m.duration && <span className="text-ink/60"> · {m.duration}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-ink/20 hover:bg-ink/5"
          >
            {t("entry.cancel")}
          </button>
          <button
            onClick={() =>
              save.mutate({
                doc_date: draft.doc_date,
                clinician_name: draft.clinician_name,
                clinician_specialty: draft.clinician_specialty,
                facility: draft.facility,
                findings_md: draft.findings_md,
                recommendations_md: draft.recommendations_md,
                user_verified: 1,
              })
            }
            disabled={save.isPending}
            className="px-4 py-2 rounded-md bg-accent hover:bg-accent/90 disabled:opacity-50"
          >
            {save.isPending ? t("documents.saving") : t("documents.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-ink/50 mb-1">{label}</span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded bg-canvas border border-ink/15 text-sm"
      />
    </label>
  );
}

function FieldArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-ink/50 mb-1">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full px-2 py-1.5 rounded bg-canvas border border-ink/15 text-sm"
      />
    </label>
  );
}

function AbnormalFlag({ flag }: { flag: number | null }) {
  if (flag === 1) return <span className="text-red-300">↑ high</span>;
  if (flag === -1) return <span className="text-amber-300">↓ low</span>;
  if (flag === 0) return <span className="text-emerald-300">in range</span>;
  return <span className="text-ink/40">—</span>;
}

function DisclaimerBanner() {
  const { t } = useTranslation();
  return (
    <div className="text-[11px] bg-amber-500/10 border border-amber-500/25 text-amber-200 rounded px-3 py-2">
      {t("documents.disclaimer")}
    </div>
  );
}
