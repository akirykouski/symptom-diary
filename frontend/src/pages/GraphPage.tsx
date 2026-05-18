import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { GraphNode, GraphEdge } from "../api/client";
import { Icons, Pill, ScreenHeader, Section } from "../ui/clario";
import { DEMO } from "../ui/demo";

/* ── Kind palette (matches design GraphScreen) ──────────────────── */
const KINDS: Record<string, { fill: string; ring: string; label: string }> = {
  symptom: { fill: "var(--accent)",  ring: "var(--accent-tint)",  label: "symptom" },
  lab:     { fill: "var(--info)",    ring: "var(--info-tint)",    label: "lab value" },
  med:     { fill: "var(--ok)",      ring: "var(--ok-tint)",      label: "medication" },
  trigger: { fill: "var(--warn)",    ring: "var(--warn-tint)",    label: "trigger" },
  time:    { fill: "var(--ink-4)",   ring: "var(--surface-2)",    label: "time-of-day" },
};

function kindFor(type: string) {
  return KINDS[type] ?? KINDS.symptom;
}

/* ── Demo constellation (from GraphScreen design) ─────────────── */
const DEMO_NODES: { id: string; x: number; y: number; kind: string; size: number }[] = [
  { id: "headache",          x: 380, y: 200, kind: "symptom", size: 28 },
  { id: "fatigue",           x: 540, y: 160, kind: "symptom", size: 32 },
  { id: "joint pain",        x: 440, y: 320, kind: "symptom", size: 24 },
  { id: "malar rash",        x: 580, y: 320, kind: "symptom", size: 22 },
  { id: "morning",           x: 260, y: 130, kind: "time",    size: 18 },
  { id: "evening",           x: 700, y: 110, kind: "time",    size: 16 },
  { id: "sun exposure",      x: 720, y: 380, kind: "trigger", size: 18 },
  { id: "unrefreshing sleep",x: 660, y: 220, kind: "symptom", size: 22 },
  { id: "ibuprofen",         x: 320, y: 400, kind: "med",     size: 20 },
  { id: "ferritin (low)",    x: 200, y: 280, kind: "lab",     size: 24 },
  { id: "hemoglobin (low)",  x: 120, y: 200, kind: "lab",     size: 22 },
  { id: "ANA 1:320",         x: 800, y: 240, kind: "lab",     size: 22 },
];
const DEMO_LINKS: [string, string][] = [
  ["headache","morning"], ["headache","fatigue"], ["fatigue","unrefreshing sleep"],
  ["joint pain","ibuprofen"], ["joint pain","malar rash"], ["malar rash","sun exposure"],
  ["ferritin (low)","fatigue"], ["hemoglobin (low)","ferritin (low)"],
  ["ANA 1:320","malar rash"], ["unrefreshing sleep","evening"],
  ["fatigue","headache"], ["joint pain","ANA 1:320"],
];

/* ── Deterministic circular layout for real nodes ─────────────── */
const VIEW_W = 900, VIEW_H = 500;
function layoutNodes(nodes: GraphNode[]): Map<string, { x: number; y: number; size: number }> {
  const map = new Map<string, { x: number; y: number; size: number }>();
  const n = nodes.length;
  if (n === 0) return map;

  const cx = VIEW_W / 2, cy = VIEW_H / 2;
  // Sort by mention_count desc so hub nodes go toward the center
  const sorted = [...nodes].sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));

  // Hub nodes (top 1/3) go inner ring, rest outer
  const hubCount = Math.max(1, Math.ceil(n / 3));
  const outerCount = n - hubCount;

  sorted.forEach((node, i) => {
    let x: number, y: number;
    if (i === 0 && n > 1) {
      // single most-connected node at center
      x = cx; y = cy;
    } else if (i < hubCount) {
      const angle = ((i - 1) / Math.max(hubCount - 1, 1)) * Math.PI * 2;
      const r = Math.min(cx, cy) * 0.38;
      x = cx + Math.cos(angle) * r;
      y = cy + Math.sin(angle) * r;
    } else {
      const oi = i - hubCount;
      const angle = (oi / Math.max(outerCount, 1)) * Math.PI * 2 - Math.PI / 5;
      const r = Math.min(cx, cy) * 0.78;
      x = cx + Math.cos(angle) * r;
      y = cy + Math.sin(angle) * r;
    }
    const size = Math.min(28, 14 + Math.pow(node.mention_count ?? 1, 0.6));
    map.set(node.id, { x, y, size });
  });
  return map;
}

/* ── Inline entity panel ──────────────────────────────────────── */
function EntitySidePanel({
  entityId,
  onClose,
  onSelect,
  isDemo,
}: {
  entityId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  isDemo: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [renameVal, setRenameVal] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  const entQ = useQuery({
    queryKey: ["entity", entityId],
    queryFn: () => api.getEntity(entityId),
    enabled: !isDemo,
  });

  const renameM = useMutation({
    mutationFn: () => api.patchEntity(entityId, { canonical_name: renameVal }),
    onSuccess: () => {
      setRenameVal(""); setShowRename(false);
      qc.invalidateQueries({ queryKey: ["entity", entityId] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const mergeM = useMutation({
    mutationFn: () => api.mergeEntity(entityId, mergeTarget),
    onSuccess: () => {
      setMergeTarget(""); setShowMerge(false);
      qc.invalidateQueries({ queryKey: ["graph"] });
      onClose();
    },
  });

  const deleteM = useMutation({
    mutationFn: () => api.deleteEntity(entityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      onClose();
    },
  });

  // demo fallback: derive from DEMO_NODES
  const demoNode = DEMO_NODES.find((n) => n.id === entityId);
  const demoNeighbors = isDemo
    ? DEMO_LINKS.filter(([a, b]) => a === entityId || b === entityId)
        .map(([a, b]) => (a === entityId ? b : a))
    : [];
  const demoMentions = DEMO.entries.slice(0, 3);

  const e = entQ.data;
  const kindKey = isDemo ? (demoNode?.kind ?? "symptom") : (e?.type ?? "symptom");
  const kindInfo = kindFor(kindKey);
  const displayName = isDemo ? entityId : (e?.canonical_name ?? entityId);
  const mentionCount = isDemo ? 5 : (e?.mention_count ?? 0);
  const neighborCount = isDemo ? demoNeighbors.length : (e?.neighbors.length ?? 0);

  return (
    <div style={{ borderLeft: "1px solid var(--border)", padding: 20, overflow: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
      {/* close */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <Pill tone={
          kindKey === "symptom" ? "accent" :
          kindKey === "lab" ? "info" :
          kindKey === "med" ? "ok" :
          kindKey === "trigger" ? "warn" : "neutral"
        }>{kindInfo.label}</Pill>
        <button className="btn ghost sm" style={{ padding: "0 8px" }} onClick={onClose}>
          <span style={{ display: "inline-flex" }}>{Icons.x}</span>
        </button>
      </div>

      <h2 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 600, letterSpacing: -0.3, color: "var(--ink)" }}>
        {displayName}
      </h2>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
        {t("graph.appearsIn", "Appears in")} {mentionCount} {t("graph.entries", "entries")} · {neighborCount} {t("graph.coOccurrences", "co-occurrences")}
      </div>

      {/* loading spinner for real mode */}
      {!isDemo && entQ.isLoading && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12 }}>{t("graph.loading", "Loading…")}</div>
      )}

      {/* Recent mentions */}
      <Section title={t("graph.recentMentions", "Recent mentions")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {isDemo
            ? demoMentions.map((entry) => (
                <div key={entry.id} style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, fontSize: 12, color: "var(--ink-2)" }}>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 3 }}>
                    {entry.ts.slice(0, 10)}
                  </div>
                  <div style={{ color: "var(--ink)", lineHeight: 1.5 }}>
                    {entry.text.slice(0, 110)}{entry.text.length > 110 ? "…" : ""}
                  </div>
                </div>
              ))
            : (e?.recent_mentions ?? []).slice(0, 3).map((m) => (
                <div key={m.id} style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, fontSize: 12, color: "var(--ink-2)" }}>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 3 }}>
                    {m.ts_event.slice(0, 10)}
                  </div>
                  <div style={{ color: "var(--ink)", lineHeight: 1.5 }}>{m.snippet}</div>
                </div>
              ))
          }
        </div>
      </Section>

      {/* Neighbors */}
      <Section title={t("graph.neighbors", "Neighbors")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {isDemo
            ? demoNeighbors.map((n) => (
                <button key={n} className="pill" style={{ cursor: "pointer" }} onClick={() => onSelect(n)}>{n}</button>
              ))
            : (e?.neighbors ?? []).map((nb) => (
                <button key={nb.id + nb.kind} className="pill" style={{ cursor: "pointer" }} onClick={() => onSelect(nb.id)}>{nb.name}</button>
              ))
          }
        </div>
      </Section>

      {/* Actions */}
      <div style={{ marginTop: 24, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn ghost sm" disabled={isDemo} onClick={() => setShowRename((v) => !v)}>
          {t("graph.rename", "Rename")}
        </button>
        <button className="btn ghost sm" disabled={isDemo} onClick={() => setShowMerge((v) => !v)}>
          {t("graph.mergeInto", "Merge into…")}
        </button>
        <button
          className="btn ghost sm"
          style={{ color: isDemo ? "var(--ink-4)" : "var(--danger)" }}
          disabled={isDemo}
          onClick={() => {
            if (!isDemo && confirm(`Delete entity "${displayName}"?`)) deleteM.mutate();
          }}
        >
          {t("graph.deleteEntity", "Delete entity")}
        </button>
      </div>

      {showRename && !isDemo && (
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <input
            className="input"
            style={{ flex: 1, fontSize: 13 }}
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            placeholder={displayName}
          />
          <button
            className="btn primary sm"
            disabled={!renameVal.trim() || renameM.isPending}
            onClick={() => renameVal.trim() && renameM.mutate()}
          >
            Save
          </button>
        </div>
      )}

      {showMerge && !isDemo && (
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <input
            className="input"
            style={{ flex: 1, fontSize: 13 }}
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder={t("graph.mergeTargetId", "Target entity ID")}
          />
          <button
            className="btn primary sm"
            disabled={!mergeTarget.trim() || mergeM.isPending}
            onClick={() => mergeTarget.trim() && mergeM.mutate()}
          >
            Merge
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function GraphPage() {
  const { t } = useTranslation();
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const graphQ = useQuery({
    queryKey: ["graph", { focus }],
    queryFn: () => api.getGraph(focus ? { focus, depth: 2 } : undefined),
    refetchInterval: 30_000,
  });

  const isDemo = !graphQ.isLoading && (graphQ.data?.nodes.length ?? 0) === 0;

  // Positions for real nodes
  const positions = useMemo(
    () => layoutNodes(graphQ.data?.nodes ?? []),
    [graphQ.data?.nodes],
  );

  // Determine which nodes/links to render
  const renderNodes: { id: string; x: number; y: number; kind: string; size: number }[] = useMemo(() => {
    if (isDemo) return DEMO_NODES;
    return (graphQ.data?.nodes ?? []).map((n: GraphNode) => {
      const pos = positions.get(n.id) ?? { x: VIEW_W / 2, y: VIEW_H / 2, size: 16 };
      return { id: n.id, x: pos.x, y: pos.y, kind: n.type, size: pos.size };
    });
  }, [isDemo, graphQ.data?.nodes, positions]);

  const renderLinks: [string, string][] = useMemo(() => {
    if (isDemo) return DEMO_LINKS;
    return (graphQ.data?.edges ?? []).map((e: GraphEdge) => [e.source, e.target] as [string, string]);
  }, [isDemo, graphQ.data?.edges]);

  const pickedId = selected ?? (isDemo ? "headache" : undefined);
  const neighborSet = useMemo(() => {
    if (!pickedId) return new Set<string>();
    return new Set(renderLinks.filter(([a, b]) => a === pickedId || b === pickedId).flat());
  }, [pickedId, renderLinks]);

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
            {t("graph.title", "Knowledge graph")}
            {isDemo && demoLabel}
          </span>
        }
        sub={t("graph.sub", "Entities AI noticed across your entries, connected by co-occurrence.")}
        actions={
          <>
            <button
              className="btn ghost"
              disabled={isDemo || !pickedId}
              onClick={() => {
                /* opens rename UI in the side panel — trigger via selected state */
              }}
            >
              {t("graph.rename", "Rename")}
            </button>
            <button
              className="btn ghost"
              disabled={isDemo || !pickedId}
            >
              {t("graph.mergeInto", "Merge…")}
            </button>
            <button className="btn ghost" onClick={() => setFilterOpen((v) => !v)}>
              <span style={{ display: "inline-flex" }}>{Icons.filter}</span>
              {t("graph.filterKinds", "Filter kinds")}
            </button>
            {filterOpen && (
              <div style={{
                position: "absolute", top: 56, right: 28, zIndex: 20,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "12px 16px", boxShadow: "var(--shadow-2)",
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                {Object.entries(KINDS).map(([k, v]) => (
                  <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: v.fill }} />
                    {v.label}
                  </label>
                ))}
                <button className="btn ghost sm" onClick={() => setFilterOpen(false)}>Done</button>
              </div>
            )}
          </>
        }
      />

      <div style={{ flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: pickedId ? "1fr 320px" : "1fr", minHeight: 0, position: "relative" }}>
        {/* Canvas */}
        <div style={{ background: "var(--surface-2)", position: "relative", overflow: "hidden" }}>
          {/* faint grid background */}
          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
            <defs>
              <pattern id="g-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.6" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#g-grid)" />
          </svg>

          {/* loading state */}
          {graphQ.isLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>
              {t("graph.loading", "Loading graph…")}
            </div>
          )}

          {/* graph SVG */}
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: "absolute", inset: 0 }}
          >
            {/* links */}
            {renderLinks.map(([a, b], i) => {
              const na = renderNodes.find((n) => n.id === a);
              const nb = renderNodes.find((n) => n.id === b);
              if (!na || !nb) return null;
              const isActive = a === pickedId || b === pickedId;
              return (
                <line
                  key={i}
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke={isActive ? "var(--accent)" : "var(--border-2)"}
                  strokeWidth={isActive ? 1.6 : 1}
                  opacity={isActive ? 0.9 : 0.5}
                />
              );
            })}

            {/* nodes */}
            {renderNodes.map((node) => {
              const k = kindFor(node.kind);
              const active = node.id === pickedId;
              const inNeighbor = neighborSet.has(node.id);
              return (
                <g
                  key={node.id}
                  onClick={() => {
                    setSelected(node.id);
                    if (!isDemo) setFocus(node.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={node.x} cy={node.y}
                    r={node.size + (active ? 6 : 0)}
                    fill={k.ring}
                    opacity={active ? 0.7 : inNeighbor ? 0.4 : 0}
                  />
                  <circle
                    cx={node.x} cy={node.y}
                    r={node.size / 2}
                    fill={k.fill}
                    stroke="var(--surface)"
                    strokeWidth="2"
                    opacity={active || inNeighbor || !pickedId ? 1 : 0.5}
                  />
                  <text
                    x={node.x}
                    y={node.y + node.size / 2 + 14}
                    textAnchor="middle"
                    fontSize="11"
                    fill={active ? "var(--ink)" : "var(--ink-2)"}
                    fontWeight={active ? 600 : 500}
                    fontFamily="Geist"
                  >
                    {node.id}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* legend */}
          <div style={{
            position: "absolute", bottom: 16, left: 16,
            display: "flex", gap: 8,
            background: "var(--surface)", padding: "8px 12px",
            borderRadius: 10, border: "1px solid var(--border)",
          }}>
            {Object.entries(KINDS).map(([k, v]) => (
              <div key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: v.fill }} />
                {v.label}
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        {pickedId && (
          <EntitySidePanel
            entityId={pickedId}
            isDemo={isDemo}
            onClose={() => { setSelected(undefined); if (!isDemo) setFocus(undefined); }}
            onSelect={(id) => { setSelected(id); if (!isDemo) setFocus(id); }}
          />
        )}
      </div>
    </>
  );
}
