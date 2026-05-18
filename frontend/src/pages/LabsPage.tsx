import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { LabPoint } from "../api/client";
import { api } from "../api/client";
import { ScreenHeader, Section, Pill, Icons } from "../ui/clario";
import { DEMO } from "../ui/demo";

/* ─── Types ──────────────────────────────────────────────────────────── */
interface SeriesRow {
  id: string;
  test: string;
  value: number | string;
  unit: string;
  ref: string;
  flag: "low" | "high" | "normal";
  date: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────── */
function parseRef(s: string): [number, number] | null {
  const m = s.match(/(-?[\d.]+)\s*[–\-]\s*(-?[\d.]+)/);
  if (m) return [+m[1], +m[2]];
  const lt = s.match(/<\s*([\d.]+)\s*\/\s*([\d.]+)/);
  if (lt) return [0, 1 / +lt[2]];
  return null;
}

function monthsBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return (
    (db.getFullYear() - da.getFullYear()) * 12 +
    (db.getMonth() - da.getMonth()) || 1
  );
}

function buildFlag(
  val: number | string,
  is_abnormal: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): "low" | "high" | "normal" {
  if (typeof val === "number") {
    if (low != null && val < low) return "low";
    if (high != null && val > high) return "high";
    return "normal";
  }
  if (is_abnormal === -1) return "low";
  if (is_abnormal === 1) return "high";
  return "normal";
}

function pointsToSeries(name: string, points: LabPoint[]): SeriesRow[] {
  return points.map((p, i) => {
    const val: number | string =
      typeof p.value_numeric === "number" ? p.value_numeric : (p.value_text ?? "—");
    const low = p.reference_low != null ? Number(p.reference_low) : undefined;
    const high = p.reference_high != null ? Number(p.reference_high) : undefined;
    const ref =
      low != null && high != null
        ? `${low}–${high}`
        : low != null
          ? `≥${low}`
          : high != null
            ? `≤${high}`
            : "—";
    return {
      id: `pt-${i}`,
      test: name,
      value: val,
      unit: p.unit ?? "",
      ref,
      flag: buildFlag(val, p.is_abnormal, low, high),
      date: p.measured_at?.slice(0, 10) ?? "—",
    };
  });
}

function exportCSV(name: string, rows: SeriesRow[]) {
  const header = "test,date,value,unit,reference,flag";
  const lines = rows.map(
    (r) => `"${r.test}","${r.date}","${r.value}","${r.unit}","${r.ref}","${r.flag}"`,
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\s+/g, "_")}_labs.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Demo grouping ──────────────────────────────────────────────────── */
function demoByTest(): Record<string, SeriesRow[]> {
  const out: Record<string, SeriesRow[]> = {};
  DEMO.labValues.forEach((l) => {
    (out[l.test] = out[l.test] || []).push({
      id: l.id,
      test: l.test,
      value: l.value,
      unit: l.unit,
      ref: l.ref,
      flag: l.flag,
      date: l.date,
    });
  });
  Object.values(out).forEach((arr) =>
    arr.sort((a, b) => a.date.localeCompare(b.date)),
  );
  return out;
}

/* ─── Page ───────────────────────────────────────────────────────────── */
export default function LabsPage() {
  const { t } = useTranslation();
  const testsQ = useQuery({ queryKey: ["labs", "tests"], queryFn: api.labsTests });
  const [selected, setSelected] = useState<string | null>(null);

  const seriesQ = useQuery({
    queryKey: ["labs", "timeline", selected],
    queryFn: () => api.labsTimeline(selected!),
    enabled: selected != null,
  });

  // Resolve real vs demo
  const realTests = testsQ.data && testsQ.data.length > 0 ? testsQ.data : null;

  // Demo data grouped by test
  const demoGroups = useMemo(() => demoByTest(), []);
  const demoTests = Object.keys(demoGroups);

  // Determine effective selected test
  const effectiveSelected = useMemo(() => {
    if (realTests) return selected;
    // demo mode: default to "Ferritin" or first
    return selected ?? (demoTests.includes("Ferritin") ? "Ferritin" : demoTests[0] ?? null);
  }, [realTests, selected, demoTests]);

  // Build series for right panel
  const series: SeriesRow[] = useMemo(() => {
    if (realTests) {
      if (!effectiveSelected || !seriesQ.data) return [];
      return pointsToSeries(effectiveSelected, seriesQ.data.points ?? []);
    }
    // demo
    return effectiveSelected ? (demoGroups[effectiveSelected] ?? []) : [];
  }, [realTests, effectiveSelected, seriesQ.data, demoGroups]);

  // Compute numeric series for chart
  const numericSeries: SeriesRow[] = series.filter((r) => typeof r.value === "number");

  const sampleDataPill = (
    <span className="pill" style={{ fontSize: 10.5, height: 20 }}>
      sample data
    </span>
  );

  const subNode = !realTests ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {t("labs.heading", "Every test you've recorded, plotted over time with reference range.")}
      {sampleDataPill}
    </span>
  ) : (
    t("labs.heading", "Every test you've recorded, plotted over time with reference range.")
  );

  // Determine list to show on left
  const leftTests: Array<{ name: string; series: SeriesRow[] }> = realTests
    ? (testsQ.data ?? []).map((it) => ({
        name: it.test_name,
        series: effectiveSelected === it.test_name ? series : [],
      }))
    : demoTests.map((name) => ({ name, series: demoGroups[name] }));

  return (
    <>
      <ScreenHeader
        title={t("labs.title", "Lab timeline")}
        sub={subNode}
        actions={
          <>
            <button className="btn ghost">
              <span style={{ display: "inline-flex" }}>{Icons.filter}</span>
              {t("labs.filterYear", "Filter by year")}
            </button>
            <button
              className="btn"
              onClick={() =>
                effectiveSelected && series.length > 0
                  ? exportCSV(effectiveSelected, series)
                  : undefined
              }
            >
              <span style={{ display: "inline-flex" }}>{Icons.download}</span>
              {t("labs.exportCsv", "Export CSV")}
            </button>
          </>
        }
      />
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          minHeight: 0,
        }}
      >
        {/* ── Left: test list ─────────────────────────────────────────── */}
        <div
          style={{
            overflow: "auto",
            borderRight: "1px solid var(--border)",
            padding: "14px 12px 24px",
          }}
        >
          {testsQ.isLoading && !demoTests.length ? (
            <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>
              {t("labs.loading", "Loading…")}
            </div>
          ) : leftTests.length === 0 ? (
            <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>
              {t("labs.empty", "No lab tests found.")}
            </div>
          ) : (
            leftTests.map(({ name }) => {
              const src = realTests ? null : demoGroups[name];
              const last = src ? src[src.length - 1] : null;
              const isPicked = effectiveSelected === name;
              const isFlag = last ? last.flag !== "normal" : false;
              return (
                <div
                  key={name}
                  onClick={() => setSelected(name)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    marginBottom: 4,
                    cursor: "pointer",
                    background: isPicked ? "var(--accent-tint)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: isPicked ? "var(--accent-strong)" : "var(--ink)",
                        flex: 1,
                      }}
                    >
                      {name}
                    </span>
                    {isFlag && last && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background:
                            last.flag === "low" ? "var(--info)" : "var(--danger)",
                        }}
                      />
                    )}
                  </div>
                  {last ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                        marginTop: 3,
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color:
                            last.flag === "low"
                              ? "var(--info)"
                              : last.flag === "high"
                                ? "var(--danger)"
                                : "var(--ink-2)",
                        }}
                      >
                        {typeof last.value === "number" && last.value < 1
                          ? `1:${Math.round(1 / last.value)}`
                          : last.value}
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {last.unit}
                      </span>
                      <span
                        className="mono"
                        style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-4)" }}
                      >
                        {src ? src.length : ""}×
                      </span>
                    </div>
                  ) : (
                    // Real-data mode: we don't have the last value without fetching
                    <div style={{ marginTop: 3, display: "flex", gap: 6 }}>
                      {realTests
                        ?.filter((t) => t.test_name === name)
                        .map((t) => (
                          <span
                            key={t.test_name}
                            className="mono"
                            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
                          >
                            {t.count}×
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Right: chart + table ─────────────────────────────────────── */}
        <div style={{ overflow: "auto", padding: "24px 28px 28px" }}>
          {effectiveSelected == null ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
              {t("labs.pickPrompt", "Pick a test on the left.")}
            </div>
          ) : seriesQ.isLoading && realTests ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
              {t("labs.loading", "Loading…")}
            </div>
          ) : (
            <>
              <LabChart series={numericSeries.length ? numericSeries : series} />
              <Section
                title={t("labs.seriesDetails", "Series details")}
                right={
                  <button className="btn ghost sm">
                    {t("labs.openDocs", "Open in documents →")}
                  </button>
                }
              >
                <LabTable rows={series} />
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── LabChart ───────────────────────────────────────────────────────── */
function LabChart({ series }: { series: SeriesRow[] }) {
  const numericRows = series.filter((s) => typeof s.value === "number");
  if (!numericRows.length) {
    return (
      <div className="card" style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>
        {series.length === 0
          ? "Pick a test on the left."
          : "No numeric values to chart for this test."}
      </div>
    );
  }

  const W = 760, H = 240, PAD_L = 56, PAD_R = 24, PAD_T = 30, PAD_B = 34;

  const refRange = parseRef(numericRows[0].ref);
  const vals = numericRows.map((s) => s.value as number);

  let yMin = Math.min(...vals);
  let yMax = Math.max(...vals);
  const span0 = Math.max(yMax - yMin, 0.01);
  if (refRange) {
    if (refRange[0] >= yMin - span0 * 2) yMin = Math.min(yMin, refRange[0]);
    if (refRange[1] <= yMax + span0 * 2) yMax = Math.max(yMax, refRange[1]);
  }
  const span = Math.max(yMax - yMin, 0.01);
  yMin -= span * 0.22;
  yMax += span * 0.22;

  const xFor = (i: number) =>
    PAD_L + (i / Math.max(numericRows.length - 1, 1)) * (W - PAD_L - PAD_R);
  const yFor = (v: number) =>
    PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  const pts = numericRows.map((s, i) => [xFor(i), yFor(s.value as number), s] as const);
  const path = pts
    .map(([x, y], i) => (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1))
    .join(" ");
  const areaPath =
    path +
    ` L ${pts[pts.length - 1][0]} ${H - PAD_B} L ${pts[0][0]} ${H - PAD_B} Z`;

  const ticks = 4;
  const tickVals = Array.from(
    { length: ticks + 1 },
    (_, i) => yMin + (i * (yMax - yMin)) / ticks,
  );

  const firstDate = numericRows[0].date;
  const lastDate = numericRows[numericRows.length - 1].date;
  const months = monthsBetween(firstDate, lastDate);

  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const lastRow = numericRows[numericRows.length - 1];

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{numericRows[0].test}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {numericRows.length} measurements over {months} month
            {months !== 1 ? "s" : ""} · reference {numericRows[0].ref} {numericRows[0].unit}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <ChartStat lab="min" v={minVal.toFixed(1)} u={numericRows[0].unit} />
          <ChartStat lab="max" v={maxVal.toFixed(1)} u={numericRows[0].unit} />
          <ChartStat
            lab="last"
            v={(lastRow.value as number).toFixed(1)}
            u={numericRows[0].unit}
            tone={lastRow.flag === "low" ? "info" : lastRow.flag === "high" ? "danger" : undefined}
          />
        </div>
      </div>

      <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }}>
        <defs>
          <linearGradient id="lgArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Reference band */}
        {refRange &&
          (() => {
            const top = Math.max(yFor(refRange[1]), PAD_T);
            const bot = Math.min(yFor(refRange[0]), H - PAD_B);
            if (bot <= top) return null;
            return (
              <g>
                <rect
                  x={PAD_L}
                  y={top}
                  width={W - PAD_L - PAD_R}
                  height={bot - top}
                  fill="var(--ok-tint)"
                  stroke="color-mix(in oklch, var(--ok) 25%, transparent)"
                  strokeDasharray="2 3"
                />
                <text
                  x={W - PAD_R - 6}
                  y={top + 12}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--ok)"
                  fontFamily="Geist Mono"
                >
                  in-range · {numericRows[0].ref} {numericRows[0].unit}
                </text>
              </g>
            );
          })()}

        {/* Y grid + labels */}
        {tickVals.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            <text
              x={PAD_L - 8}
              y={yFor(v) + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-3)"
              fontFamily="Geist Mono"
            >
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* X labels */}
        {pts.map(([x, , s], i) => (
          <text
            key={i}
            x={x}
            y={H - PAD_B + 16}
            textAnchor="middle"
            fontSize="10.5"
            fill="var(--ink-3)"
            fontFamily="Geist Mono"
          >
            {s.date.slice(2, 7)}
          </text>
        ))}

        {/* Area + line */}
        <path d={areaPath} fill="url(#lgArea)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {pts.map(([x, y, s], i) => {
          const color =
            s.flag === "low"
              ? "var(--info)"
              : s.flag === "high"
                ? "var(--danger)"
                : "var(--accent)";
          const isLast = i === pts.length - 1;
          const valDisplay =
            typeof s.value === "number" && s.value < 1
              ? `1:${Math.round(1 / s.value)}`
              : typeof s.value === "number"
                ? s.value.toFixed(1)
                : s.value;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="6" fill="var(--surface)" stroke={color} strokeWidth="2" />
              <circle cx={x} cy={y} r="2.6" fill={color} />
              {isLast && (
                <g>
                  <rect x={x + 10} y={y - 19} width="62" height="22" rx="6" fill="var(--ink)" />
                  <text
                    x={x + 16}
                    y={y - 4}
                    fontSize="11"
                    fill="white"
                    fontFamily="Geist Mono"
                  >
                    {valDisplay} {s.unit}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ChartStat({
  lab,
  v,
  u,
  tone,
}: {
  lab: string;
  v: string;
  u: string;
  tone?: "info" | "danger";
}) {
  const c = tone === "info" ? "var(--info)" : tone === "danger" ? "var(--danger)" : "var(--ink)";
  return (
    <div style={{ textAlign: "right" }}>
      <div className="k-label">{lab}</div>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 3, justifyContent: "flex-end" }}
      >
        <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: c, letterSpacing: -0.3 }}>
          {v}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          {u}
        </span>
      </div>
    </div>
  );
}

/* ─── LabTable ───────────────────────────────────────────────────────── */
function LabTable({ rows }: { rows: SeriesRow[] }) {
  if (!rows.length) {
    return (
      <div style={{ color: "var(--ink-3)", fontSize: 13 }}>No data for this test.</div>
    );
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1.4fr 90px",
          gap: 0,
          padding: "10px 14px",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {["Test", "Value", "Unit", "Reference", "Flag"].map((h) => (
          <div key={h} className="k-label">
            {h}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1.4fr 90px",
            padding: "10px 14px",
            alignItems: "center",
            borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)",
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
