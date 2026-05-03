import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export default function EntityPanel({
  entityId,
  onClose,
  onFocus,
}: {
  entityId: string;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ent = useQuery({
    queryKey: ["entity", entityId],
    queryFn: () => api.getEntity(entityId),
  });

  const [renameValue, setRenameValue] = useState("");

  const renameM = useMutation({
    mutationFn: () => api.patchEntity(entityId, { canonical_name: renameValue }),
    onSuccess: () => {
      setRenameValue("");
      qc.invalidateQueries({ queryKey: ["entity", entityId] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const deleteM = useMutation({
    mutationFn: () => api.deleteEntity(entityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      onClose();
    },
  });

  if (ent.isLoading || !ent.data) {
    return <div className="p-4 text-ink/60">Loading…</div>;
  }
  const e = ent.data;
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-xs uppercase text-ink/40">{e.type}</div>
          <h2 className="text-lg font-semibold">{e.canonical_name}</h2>
          {e.aliases.length > 1 && (
            <div className="text-xs text-ink/50 mt-1">
              aka: {e.aliases.filter((a) => a !== e.canonical_name).join(", ")}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-ink/40 hover:text-ink/80 px-1"
        >
          ✕
        </button>
      </div>

      <div className="text-sm text-ink/70">
        {t("graph.mentions")}: <span className="font-medium">{e.mention_count ?? 0}</span>
      </div>

      <div className="border border-ink/10 rounded-md p-3 space-y-2">
        <div className="text-xs text-ink/40">{t("graph.rename")}</div>
        <div className="flex gap-2">
          <input
            value={renameValue}
            onChange={(ev) => setRenameValue(ev.target.value)}
            placeholder={e.canonical_name}
            className="flex-1 px-2 py-1 rounded bg-canvas border border-ink/20 text-sm focus:border-accent outline-none"
          />
          <button
            onClick={() => renameValue.trim() && renameM.mutate()}
            disabled={!renameValue.trim() || renameM.isPending}
            className="bg-accent/80 hover:bg-accent disabled:opacity-50 px-3 py-1 rounded text-xs font-medium"
          >
            ↩
          </button>
        </div>
      </div>

      {e.recent_mentions.length > 0 && (
        <div>
          <div className="text-xs uppercase text-ink/40 mb-2">Recent</div>
          <ul className="space-y-1.5">
            {e.recent_mentions.map((m) => (
              <li
                key={m.id}
                className="text-xs border-l-2 border-ink/20 pl-2 text-ink/70"
              >
                <div className="text-ink/40">
                  {new Date(m.ts_event).toLocaleString()}
                </div>
                <div className="line-clamp-2">{m.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.neighbors.length > 0 && (
        <div>
          <div className="text-xs uppercase text-ink/40 mb-2">
            {t("graph.neighbors")}
          </div>
          <ul className="space-y-1">
            {e.neighbors.map((n) => (
              <li key={n.id + n.kind} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => onFocus(n.id)}
                  className="flex-1 text-left hover:text-ink"
                >
                  {n.name}
                </button>
                <span className="text-xs text-ink/40">
                  {n.kind} · {n.evidence_count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={() => {
          if (confirm(`Delete entity "${e.canonical_name}"?`)) deleteM.mutate();
        }}
        className="w-full px-3 py-1.5 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm"
      >
        {t("graph.deleteEntity")}
      </button>
    </div>
  );
}
