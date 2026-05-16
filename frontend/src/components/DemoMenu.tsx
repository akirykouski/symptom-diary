import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Loads a curated synthetic patient and immediately runs the hypothesis
 * engine afterwards, so the reskinned screens have real data to render.
 */
export default function DemoMenu({ entryCount }: { entryCount: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const personas = useQuery({ queryKey: ["demo", "personas"], queryFn: api.listPersonas });
  const active = useQuery({ queryKey: ["demo", "active"], queryFn: api.activePersona });

  const load = useMutation({
    mutationFn: async ({ id, overwrite }: { id: string; overwrite: boolean }) => {
      const result = await api.loadPersona(id, overwrite);
      try {
        await api.recheckHypotheses();
      } catch {
        /* engine is best-effort */
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setOpen(false);
    },
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn sm"
        onClick={() => setOpen((v) => !v)}
        title={t("demo.tooltip")}
      >
        {active.data?.persona_id ? `📋 ${active.data.persona_id}` : t("demo.button")}
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 320,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-3)",
            zIndex: 40,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="k-label" style={{ marginBottom: 2 }}>
            {t("demo.heading")}
          </div>
          {(personas.data ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => load.mutate({ id: p.id, overwrite: entryCount > 0 })}
              disabled={load.isPending}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{p.summary}</div>
            </button>
          ))}
          {entryCount > 0 && (
            <p style={{ fontSize: 11, color: "oklch(48% 0.12 75)", margin: "2px 4px 0" }}>
              {t("demo.warnOverwrite")}
            </p>
          )}
          {load.error && (
            <p style={{ fontSize: 11, color: "var(--danger)", margin: "2px 4px 0" }}>
              {load.error instanceof Error ? load.error.message : "Failed"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
