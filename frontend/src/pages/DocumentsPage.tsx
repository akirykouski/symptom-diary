import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentRecord } from "../api/client";
import { api } from "../api/client";
import { Icons, Pill, ScreenHeader, Tab, Section } from "../ui/clario";
import type { Tone } from "../ui/clario";
import { DEMO, pick } from "../ui/demo";
import type { DemoDoc, DemoLab } from "../ui/demo";

/* ─── Doc type metadata ──────────────────────────────────────────────── */
const DOC_TYPE_META: Record<string, { label: string; tone: Tone }> = {
  visit_note:   { label: "Visit note",   tone: "accent"  },
  lab_result:   { label: "Lab result",   tone: "info"    },
  prescription: { label: "Prescription", tone: "ok"      },
  imaging:      { label: "Imaging",      tone: "warn"    },
  discharge:    { label: "Discharge",    tone: "neutral" },
  referral:     { label: "Referral",     tone: "neutral" },
  other:        { label: "Document",     tone: "neutral" },
};

function docMeta(type: string) {
  return DOC_TYPE_META[type] ?? { label: "Document", tone: "neutral" as Tone };
}

/* ─── Shapes used internally ─────────────────────────────────────────── */
type LabRow = {
  id: string;
  test: string;
  value: string | number;
  unit: string;
  ref: string;
  flag: "low" | "high" | "normal";
};

type DocShape = {
  id: string;
  type: string;
  title: string;
  date: string;
  clinician: string;
  specialty: string;
  facility: string;
  findings?: string;
  recommendations?: string;
  verified: boolean;
  hasMedia: boolean;
  labRows: LabRow[];
  /** real record for mutations; absent in demo mode */
  _real?: DocumentRecord;
};

function realToShape(d: DocumentRecord): DocShape {
  return {
    id: d.id,
    type: d.doc_type,
    title: docMeta(d.doc_type).label,
    date: d.doc_date ?? d.created_at.slice(0, 10),
    clinician: d.clinician_name ?? "—",
    specialty: d.clinician_specialty ?? "—",
    facility: d.facility ?? "—",
    findings: d.findings_md ?? undefined,
    recommendations: d.recommendations_md ?? undefined,
    verified: d.user_verified === 1,
    hasMedia: !!d.media_id,
    labRows: d.lab_values.map((lv) => ({
      id: lv.id,
      test: lv.test_name_raw,
      value: lv.value_numeric ?? lv.value_text ?? "—",
      unit: lv.unit ?? "—",
      ref:
        lv.reference_low != null || lv.reference_high != null
          ? `${lv.reference_low ?? "?"} – ${lv.reference_high ?? "?"}`
          : "—",
      flag:
        lv.is_abnormal === -1
          ? "low"
          : lv.is_abnormal === 1
            ? lv.reference_high != null &&
              Number(lv.value_numeric) > Number(lv.reference_high)
              ? "high"
              : "low"
            : "normal",
    })),
    _real: d,
  };
}

function demoToShape(d: DemoDoc, labs: DemoLab[]): DocShape {
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    date: d.date,
    clinician: d.clinician,
    specialty: d.specialty,
    facility: d.facility,
    findings: d.findings,
    recommendations: d.recommendations,
    verified: d.verified,
    hasMedia: d.hasMedia,
    labRows: labs
      .filter((l) => l.docId === d.id)
      .map((l) => ({
        id: l.id,
        test: l.test,
        value: l.value,
        unit: l.unit,
        ref: l.ref,
        flag: l.flag,
      })),
  };
}

/* ─── Page ───────────────────────────────────────────────────────────── */
export default function DocumentsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>("all");

  const docsQuery = useQuery({
    queryKey: ["documents", { type: filter === "all" ? undefined : filter }],
    queryFn: () =>
      api.listDocuments(filter !== "all" ? { type: filter } : undefined),
  });

  const { rows: rawRows, isDemo } = pick(docsQuery.data, DEMO.documents);

  // Build unified DocShape list
  const docs: DocShape[] = isDemo
    ? (rawRows as DemoDoc[]).map((d) => demoToShape(d, DEMO.labValues))
    : (rawRows as DocumentRecord[]).map(realToShape);

  // Apply filter in demo mode (real API filters server-side)
  const visibleDocs =
    isDemo && filter !== "all"
      ? docs.filter((d) => d.type === filter)
      : docs;

  // Count per type for tabs (across all docs, not filtered)
  const allDocs: DocShape[] = isDemo
    ? (DEMO.documents as DemoDoc[]).map((d) => demoToShape(d, DEMO.labValues))
    : (docsQuery.data ?? []).map(realToShape);

  const countAll = allDocs.length;
  const countByType = (type: string) => allDocs.filter((d) => d.type === type).length;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select first when list changes
  const effectiveSelected =
    visibleDocs.find((d) => d.id === selectedId) ?? visibleDocs[0] ?? null;

  return (
    <>
      <ScreenHeader
        title={t("documents.heading", "Medical documents")}
        sub={t(
          "documents.sub",
          "Visit notes, labs and prescriptions you've attached. Vision-AI extracts fields you can verify.",
        )}
        tabs={
          <>
            <Tab
              active={filter === "all"}
              onClick={() => setFilter("all")}
              count={countAll}
            >
              {t("documents.all", "All")}
            </Tab>
            {Object.entries(DOC_TYPE_META)
              .filter(([k]) => k !== "other")
              .map(([k, v]) => {
                const c = countByType(k);
                if (!c) return null;
                return (
                  <Tab
                    key={k}
                    active={filter === k}
                    onClick={() => setFilter(k)}
                    count={c}
                  >
                    {t(`documents.types.${k}`, v.label)}
                  </Tab>
                );
              })}
          </>
        }
        actions={
          <>
            {isDemo && (
              <span
                className="pill"
                style={{ fontSize: 10.5, height: 20, lineHeight: "20px" }}
              >
                sample data
              </span>
            )}
            <button className="btn" disabled>
              <span style={{ display: "inline-flex" }}>{Icons.paperclip}</span>
              {t("documents.attach", "Attach document")}
            </button>
          </>
        }
      />

      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          minHeight: 0,
        }}
      >
        {/* ── Left: list ────────────────────────────────────────── */}
        <div
          style={{
            overflow: "auto",
            borderRight: "1px solid var(--border)",
            padding: "14px 16px 24px",
          }}
        >
          {docsQuery.isLoading && !isDemo ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 8 }}>
              {t("documents.loading", "Loading…")}
            </div>
          ) : visibleDocs.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 8 }}>
              {t("documents.empty", "No documents.")}
            </div>
          ) : (
            visibleDocs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                active={doc.id === effectiveSelected?.id}
                onClick={() => setSelectedId(doc.id)}
              />
            ))
          )}
        </div>

        {/* ── Right: detail ─────────────────────────────────────── */}
        <div
          style={{
            overflow: "auto",
            padding: "22px 28px 28px",
            background: "var(--surface-2)",
          }}
        >
          {effectiveSelected ? (
            <DocDetail doc={effectiveSelected} isDemo={isDemo} />
          ) : (
            <div
              style={{ color: "var(--ink-3)", fontSize: 13, padding: "16px 0" }}
            >
              {t("documents.selectPrompt", "Select a document on the left.")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── DocCard ────────────────────────────────────────────────────────── */
function DocCard({
  doc,
  active,
  onClick,
}: {
  doc: DocShape;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const tm = docMeta(doc.type);
  return (
    <div
      onClick={onClick}
      style={{
        padding: 14,
        borderRadius: 12,
        marginBottom: 8,
        cursor: "pointer",
        background: active ? "var(--surface)" : "transparent",
        border:
          "1px solid " +
          (active
            ? "color-mix(in oklch, var(--accent) 25%, var(--border))"
            : "transparent"),
        boxShadow: active
          ? "0 1px 2px rgba(20,28,40,.04), 0 4px 12px rgba(20,28,40,.04)"
          : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Pill tone={tm.tone}>
          {t(`documents.types.${doc.type}`, tm.label)}
        </Pill>
        {doc.verified ? (
          <Pill tone="ok">
            <span style={{ display: "inline-flex", width: 11, height: 11 }}>
              {Icons.check}
            </span>
            {t("documents.verified", "verified")}
          </Pill>
        ) : (
          <Pill tone="warn">
            <span style={{ display: "inline-flex", width: 11, height: 11 }}>
              {Icons.alert}
            </span>
            {t("documents.needsReview", "needs review")}
          </Pill>
        )}
        <span
          className="mono"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}
        >
          {doc.date}
        </span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>
        {doc.title}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
        {doc.clinician}
        {doc.facility && doc.facility !== "—" ? ` · ${doc.facility}` : ""}
      </div>
    </div>
  );
}

/* ─── DocDetail ──────────────────────────────────────────────────────── */
function DocDetail({
  doc,
  isDemo,
}: {
  doc: DocShape;
  isDemo: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tm = docMeta(doc.type);

  const verify = useMutation({
    mutationFn: () => api.patchDocument(doc._real!.id, { user_verified: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });

  return (
    <div className="card" style={{ padding: 24, boxShadow: "var(--shadow-1)" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Pill tone={tm.tone}>
              {t(`documents.types.${doc.type}`, tm.label)}
            </Pill>
            {doc.verified ? (
              <Pill tone="ok">
                {t("documents.verifiedByYou", "verified by you")}
              </Pill>
            ) : (
              <Pill tone="warn">
                {t("documents.awaitingVerification", "awaiting verification")}
              </Pill>
            )}
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: -0.3,
              color: "var(--ink)",
            }}
          >
            {doc.title}
          </h2>
          <div
            style={{ marginTop: 6, fontSize: 13, color: "var(--ink-2)" }}
          >
            {doc.clinician}
            {doc.specialty && doc.specialty !== "—"
              ? ` · ${doc.specialty}`
              : ""}
            {doc.facility && doc.facility !== "—"
              ? ` · ${doc.facility}`
              : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {doc.hasMedia && doc._real && (
            <a
              href={api.mediaUrl(doc._real.media_id)}
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              <span style={{ display: "inline-flex" }}>{Icons.ext}</span>
              {t("documents.openOriginal", "Open original")}
            </a>
          )}
        </div>
      </div>

      {/* 3-cell field grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Field2
          k={t("documents.fields.docDate", "Document date")}
          v={<span className="mono">{doc.date}</span>}
        />
        <Field2
          k={t("documents.fields.clinician", "Clinician")}
          v={doc.clinician}
        />
        <Field2
          k={t("documents.fields.facility", "Facility")}
          v={doc.facility}
        />
      </div>

      {/* Findings */}
      {doc.findings && (
        <Section title={t("documents.fields.findings", "Findings (verbatim)")}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--ink)",
            }}
          >
            {doc.findings}
          </p>
        </Section>
      )}

      {/* Recommendations */}
      {doc.recommendations && (
        <Section
          title={t(
            "documents.fields.recommendations",
            "Recommendations (verbatim)",
          )}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--ink)",
            }}
          >
            {doc.recommendations}
          </p>
        </Section>
      )}

      {/* Lab values */}
      {doc.labRows.length > 0 && (
        <Section
          title={t("documents.labs", "Lab values")}
          right={
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {doc.labRows.length}{" "}
              {t("documents.valuesExtracted", "values extracted")}
            </span>
          }
        >
          <LabTable rows={doc.labRows} />
        </Section>
      )}

      {/* Verify amber box */}
      {!doc.verified && (
        <div
          style={{
            marginTop: 24,
            padding: 14,
            borderRadius: 10,
            background: "var(--warn-tint)",
            border:
              "1px solid color-mix(in oklch, var(--warn) 25%, var(--border))",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: "var(--warn)", display: "inline-flex" }}>
            {Icons.alert}
          </span>
          <div
            style={{ flex: 1, fontSize: 12.5, color: "oklch(38% 0.10 75)" }}
          >
            <b style={{ color: "oklch(28% 0.10 75)" }}>
              {t(
                "documents.aiExtracted",
                "AI extracted these fields from a photo.",
              )}
            </b>{" "}
            {t(
              "documents.disclaimer",
              "Verify before treating any value as authoritative — this is not a diagnosis.",
            )}
          </div>
          <button
            className="btn primary"
            disabled={isDemo || verify.isPending}
            onClick={() => !isDemo && verify.mutate()}
          >
            {verify.isPending
              ? t("documents.saving", "Saving…")
              : t("documents.confirm", "Confirm & save")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Field2 ─────────────────────────────────────────────────────────── */
function Field2({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="k-label">{k}</div>
      <div style={{ fontSize: 13.5, color: "var(--ink)", marginTop: 3 }}>
        {v}
      </div>
    </div>
  );
}

/* ─── LabTable ───────────────────────────────────────────────────────── */
function LabTable({ rows }: { rows: LabRow[] }) {
  const { t } = useTranslation();
  const cols = "2fr 1fr 1fr 1.4fr 90px";
  const headers = [
    t("documents.labCols.test", "Test"),
    t("documents.labCols.value", "Value"),
    t("documents.labCols.unit", "Unit"),
    t("documents.labCols.range", "Reference"),
    t("documents.labCols.flag", "Flag"),
  ];
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          gap: 0,
          padding: "10px 14px",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {headers.map((h) => (
          <div key={h} className="k-label">
            {h}
          </div>
        ))}
      </div>
      {/* rows */}
      {rows.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            padding: "10px 14px",
            alignItems: "center",
            borderBottom:
              i === rows.length - 1 ? "none" : "1px solid var(--border)",
            fontSize: 12.5,
          }}
        >
          <div style={{ fontWeight: 500 }}>{r.test}</div>
          <div
            className="mono"
            style={{
              fontWeight: 600,
              color:
                r.flag === "low"
                  ? "var(--info)"
                  : r.flag === "high"
                    ? "var(--danger)"
                    : "var(--ink)",
            }}
          >
            {typeof r.value === "number" && r.value < 1
              ? `1:${Math.round(1 / r.value)}`
              : r.value}
          </div>
          <div className="mono" style={{ color: "var(--ink-3)" }}>
            {r.unit}
          </div>
          <div className="mono" style={{ color: "var(--ink-3)" }}>
            {r.ref}
          </div>
          <div>
            {r.flag === "low" && (
              <Pill tone="info" dot>
                low
              </Pill>
            )}
            {r.flag === "high" && (
              <Pill tone="danger" dot>
                high
              </Pill>
            )}
            {r.flag === "normal" && (
              <Pill tone="ok" dot>
                in range
              </Pill>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
