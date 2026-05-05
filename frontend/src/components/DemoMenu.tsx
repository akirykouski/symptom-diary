import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Tiny dropdown that loads a curated synthetic patient and immediately runs
 * the hypothesis engine afterwards. Hidden once a real entry exists, unless
 * the user opts in.
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
      // Kick off a recheck immediately so the Hypotheses page is populated.
      try {
        await api.recheckHypotheses();
      } catch {
        /* engine is best-effort; user can press recheck manually */
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setOpen(false);
    },
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-ink/5 text-ink/65"
        title={t("demo.tooltip")}
      >
        {active.data?.persona_id ? `📋 ${active.data.persona_id}` : t("demo.button")}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 bg-canvas border border-ink/15 rounded-lg shadow-xl z-30 p-3 space-y-2"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-xs uppercase text-ink/45 mb-1">{t("demo.heading")}</div>
          {(personas.data ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => load.mutate({ id: p.id, overwrite: entryCount > 0 })}
              disabled={load.isPending}
              className="w-full text-left px-3 py-2 rounded border border-ink/10 hover:border-accent/40 hover:bg-ink/5 disabled:opacity-50"
            >
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-[11px] text-ink/55 mt-0.5">{p.summary}</div>
            </button>
          ))}
          {entryCount > 0 && (
            <p className="text-[11px] text-amber-300/80 px-1">{t("demo.warnOverwrite")}</p>
          )}
          {load.error && (
            <p className="text-[11px] text-red-300 px-1">
              {load.error instanceof Error ? load.error.message : "Failed"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
