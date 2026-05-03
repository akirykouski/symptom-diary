import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";
import { api } from "../api/client";
import type { GraphNode } from "../api/client";
import EntityPanel from "../components/EntityPanel";

const TYPE_COLORS: Record<string, string> = {
  symptom: "#ef4444",
  trigger: "#f59e0b",
  bodypart: "#3b82f6",
  med: "#a855f7",
  food: "#22c55e",
  activity: "#06b6d4",
  emotion: "#ec4899",
  other: "#94a3b8",
};

export default function GraphPage() {
  const { t } = useTranslation();
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const graph = useQuery({
    queryKey: ["graph", { focus }],
    queryFn: () => api.getGraph(focus ? { focus, depth: 2 } : undefined),
    refetchInterval: 30_000,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    function measure() {
      const r = containerRef.current?.getBoundingClientRect();
      if (r) setSize({ w: r.width, h: r.height });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const data = useMemo(() => {
    const g = graph.data ?? { nodes: [], edges: [] };
    return {
      nodes: g.nodes.map((n) => ({ ...n })),
      links: g.edges.map((e) => ({
        ...e,
        source: e.source,
        target: e.target,
      })),
    };
  }, [graph.data]);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ←
        </Link>
        <h1 className="text-lg font-semibold">{t("graph.title")}</h1>
        {focus && (
          <button
            onClick={() => {
              setFocus(undefined);
              setSelected(undefined);
            }}
            className="text-sm text-ink/60 hover:text-ink"
          >
            (clear focus)
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-ink/60">{type}</span>
            </span>
          ))}
        </div>
      </header>

      <main className="flex-1 min-h-0 flex">
        <div ref={containerRef} className="flex-1 min-h-0 relative">
          {graph.isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-ink/60">
              {t("graph.loading")}
            </div>
          )}
          {!graph.isLoading && data.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-ink/60 text-center px-8">
              {t("graph.empty")}
            </div>
          )}
          <ForceGraph2D
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor="#0c0c10"
            nodeRelSize={4}
            nodeVal={(n: GraphNode) => Math.min(20, 4 + (n.mention_count ?? 1))}
            nodeColor={(n: GraphNode) => TYPE_COLORS[n.type] ?? "#94a3b8"}
            nodeLabel={(n: GraphNode) =>
              `${n.name} (${n.type}, ${n.mention_count ?? 0})`
            }
            linkColor={(l) =>
              (l as { kind: string }).kind === "precedes"
                ? "rgba(124,92,255,0.5)"
                : "rgba(255,255,255,0.18)"
            }
            linkWidth={(l) =>
              Math.min(3, 0.5 + Math.log2(1 + (l as { weight: number }).weight))
            }
            linkDirectionalArrowLength={(l) =>
              (l as { kind: string }).kind === "precedes" ? 4 : 0
            }
            linkDirectionalArrowRelPos={1}
            cooldownTicks={120}
            onNodeClick={(n) => {
              const node = n as GraphNode;
              setSelected(node.id);
            }}
            onNodeRightClick={(n) => setFocus((n as GraphNode).id)}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(n, ctx, globalScale) => {
              const node = n as GraphNode & { x?: number; y?: number };
              if (!node.x || !node.y) return;
              const fontSize = 11 / globalScale;
              ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
              ctx.fillStyle = "rgba(232,232,238,0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(node.name, node.x, node.y + 6);
            }}
          />
        </div>
        {selected && (
          <aside className="w-96 border-l border-ink/10 overflow-y-auto">
            <EntityPanel
              entityId={selected}
              onClose={() => setSelected(undefined)}
              onFocus={(id) => {
                setFocus(id);
                setSelected(id);
              }}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
