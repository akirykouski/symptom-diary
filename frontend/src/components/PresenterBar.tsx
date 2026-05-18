import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Icons } from "../ui/clario";

/**
 * Presenter Mode — a slim, opt-in stage aid. It is NEVER shown to a normal
 * user: it only appears when the URL has `?present=1` or the presenter
 * toggles it with Shift+P. The flag persists across route changes via
 * sessionStorage so navigation never drops it.
 *
 * It does three demo-safe things and nothing destructive:
 *  1. Confirms what judges are seeing (offline sample vs. your real data),
 *     so the deterministic Maria fallback is never a surprise on stage.
 *  2. One-click jumps along the pitch arc (Timeline → Patterns → Brief →
 *     AI models → Mobile) so navigation can't be fumbled.
 *  3. "Load <persona> · live AI" runs the REAL pipeline
 *     (POST /api/demo/load + hypotheses recheck) for the depth segment.
 */

const ARC: { label: string; to: string }[] = [
  { label: "1 · Timeline", to: "/" },
  { label: "2 · Patterns", to: "/hypotheses" },
  { label: "3 · Brief", to: "/insights" },
  { label: "4 · AI models", to: "/llm" },
  { label: "5 · Mobile", to: "/mobile" },
];

const SS_KEY = "clario_present";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("present") === "1") {
    sessionStorage.setItem(SS_KEY, "1");
    return true;
  }
  return sessionStorage.getItem(SS_KEY) === "1";
}

export default function PresenterBar() {
  const [active, setActive] = useState<boolean>(readInitial);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Shift+P toggles presenter mode even without the query param.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "P" || e.key === "p")) {
        setActive((v) => {
          const next = !v;
          sessionStorage.setItem(SS_KEY, next ? "1" : "0");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const personas = useQuery({
    queryKey: ["demo", "personas"],
    queryFn: api.listPersonas,
    enabled: active,
  });
  const activePersona = useQuery({
    queryKey: ["demo", "active"],
    queryFn: api.activePersona,
    enabled: active,
  });
  const entries = useQuery({
    queryKey: ["entries", { tag: undefined }],
    queryFn: () => api.listEntries(),
    enabled: active,
  });

  const load = useMutation({
    mutationFn: async (personaId: string) => {
      const result = await api.loadPersona(personaId, true);
      try {
        await api.recheckHypotheses();
      } catch {
        /* best-effort — engine recheck can also be triggered from Patterns */
      }
      return result;
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!active) return null;

  const loadedId = activePersona.data?.persona_id;
  const hasRealData = (entries.data ?? []).length > 0;
  const showing =
    loadedId
      ? `live persona · ${loadedId}`
      : hasRealData
        ? "your real journal data"
        : "offline sample (Maria) — deterministic, no AI calls";

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border-2)",
        borderRadius: 999,
        boxShadow: "var(--shadow-3)",
        fontSize: 12,
        maxWidth: "94vw",
        flexWrap: "wrap",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 600,
          color: "var(--accent-strong)",
          letterSpacing: 0.2,
        }}
      >
        <span style={{ display: "inline-flex" }}>{Icons.sparkle}</span>
        Presenter
      </span>

      <span
        className="pill"
        title="What judges currently see on every screen"
        style={{ fontSize: 11, height: 22 }}
      >
        {showing}
      </span>

      <span style={{ width: 1, height: 18, background: "var(--border)" }} />

      {ARC.map((s) => (
        <button
          key={s.to}
          className="btn sm ghost"
          onClick={() => navigate(s.to)}
          style={{ height: 24 }}
        >
          {s.label}
        </button>
      ))}

      <span style={{ width: 1, height: 18, background: "var(--border)" }} />

      {(personas.data ?? []).slice(0, 3).map((p) => (
        <button
          key={p.id}
          className="btn sm"
          disabled={load.isPending}
          onClick={() => load.mutate(p.id)}
          title={`Run the real local pipeline for ${p.title} (overwrites the journal, then re-checks patterns)`}
          style={{ height: 24 }}
        >
          {load.isPending && load.variables === p.id ? "Loading…" : `Load ${p.title.split(" ")[0]} · live`}
        </button>
      ))}

      <button
        className="btn sm ghost"
        onClick={() => {
          sessionStorage.setItem(SS_KEY, "0");
          setActive(false);
        }}
        title="Hide presenter bar (Shift+P to bring back)"
        aria-label="Hide presenter bar"
        style={{ height: 24, padding: "0 6px" }}
      >
        {Icons.x}
      </button>
    </div>
  );
}
