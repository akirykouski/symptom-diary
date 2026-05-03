import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, streamPull } from "../api/client";
import type { PullChunk } from "../api/client";

interface PullState {
  model: string;
  status: string;
  total?: number;
  completed?: number;
  done: boolean;
  error?: string;
}

export default function LlmSetup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["llm", "status"],
    queryFn: api.llmStatus,
    refetchInterval: 5_000,
  });

  const [custom, setCustom] = useState("");
  const [pull, setPull] = useState<PullState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function startPull(model: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPull({ model, status: "starting", done: false });
    try {
      await streamPull(
        model,
        (chunk: PullChunk) => {
          setPull((prev) => ({
            model,
            status: chunk.status ?? prev?.status ?? "",
            total: chunk.total ?? prev?.total,
            completed: chunk.completed ?? prev?.completed,
            done: chunk.status === "success",
            error: chunk.error ?? prev?.error,
          }));
        },
        ac.signal,
      );
      setPull((prev) => (prev ? { ...prev, done: true } : prev));
      qc.invalidateQueries({ queryKey: ["llm", "status"] });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setPull((prev) =>
        prev ? { ...prev, error: (e as Error).message, done: true } : prev,
      );
    }
  }

  return (
    <div className="h-full">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ←
        </Link>
        <h1 className="text-lg font-semibold">{t("llm.title")}</h1>
      </header>

      <div className="p-6 max-w-2xl space-y-6">
        <p className="text-ink/70">{t("llm.intro")}</p>

        <ConnectionBanner data={status.data} loading={status.isLoading} />

        {status.data && (
          <div className="space-y-3">
            {Object.entries(status.data.models).map(([modelName, installed]) => (
              <ModelRow
                key={modelName}
                label={
                  modelName === status.data!.installed?.[0]
                    ? t("llm.extractor")
                    : modelName.includes("embed")
                    ? t("llm.embedder")
                    : t("llm.modelLabel")
                }
                model={modelName}
                installed={installed}
                ollamaUp={status.data!.ollama}
                pull={pull}
                onPull={() => startPull(modelName)}
                onCancel={() => abortRef.current?.abort()}
              />
            ))}
          </div>
        )}

        <div className="border border-ink/10 rounded-lg p-4">
          <span className="block text-sm text-ink/70 mb-2">
            {t("llm.customModel")}
          </span>
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. llama3.2:3b"
              className="flex-1 px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
            />
            <button
              onClick={() => custom.trim() && startPull(custom.trim())}
              disabled={!custom.trim() || !status.data?.ollama}
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium"
            >
              {t("llm.customPull")}
            </button>
          </div>
        </div>

        {status.data?.installed && status.data.installed.length > 0 && (
          <div className="text-sm text-ink/50">
            <span className="font-medium">Installed:</span>{" "}
            {status.data.installed.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionBanner({
  data,
  loading,
}: {
  data: { ollama: boolean; url: string } | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading || !data) {
    return <div className="text-ink/60">{t("llm.checking")}</div>;
  }
  if (data.ollama) {
    return (
      <div className="px-4 py-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-sm">
        ● {t("llm.ollamaUp")} <code>{data.url}</code>
      </div>
    );
  }
  return (
    <div className="px-4 py-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
      ● {t("llm.ollamaDown")} <code>{data.url}</code>
    </div>
  );
}

function ModelRow({
  label,
  model,
  installed,
  ollamaUp,
  pull,
  onPull,
  onCancel,
}: {
  label: string;
  model: string;
  installed: boolean;
  ollamaUp: boolean;
  pull: PullState | null;
  onPull: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const active = pull && pull.model === model && !pull.done;
  const pct =
    pull && pull.model === model && pull.total
      ? Math.min(100, Math.round(((pull.completed ?? 0) / pull.total) * 100))
      : null;
  return (
    <div className="border border-ink/10 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-sm text-ink/50">{label}</div>
          <div className="font-mono text-sm">{model}</div>
        </div>
        <div className="flex items-center gap-2">
          {installed ? (
            <span className="text-emerald-400 text-sm">✓ {t("llm.modelInstalled")}</span>
          ) : (
            <span className="text-amber-300 text-sm">{t("llm.modelMissing")}</span>
          )}
          {active ? (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md border border-ink/20 hover:bg-ink/5 text-sm"
            >
              {t("llm.pullCancel")}
            </button>
          ) : (
            <button
              onClick={onPull}
              disabled={!ollamaUp || installed}
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-3 py-1.5 rounded-md text-sm font-medium"
            >
              {installed ? "✓" : t("llm.pullModel")}
            </button>
          )}
        </div>
      </div>
      {pull && pull.model === model && (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-ink/50">
            {pull.status}
            {pct != null && ` — ${pct}%`}
          </div>
          {pct != null && (
            <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {pull.error && (
            <div className="text-sm text-red-400">
              {t("llm.pullError")}: {pull.error}
            </div>
          )}
          {pull.done && !pull.error && (
            <div className="text-sm text-emerald-400">{t("llm.pullDone")}</div>
          )}
        </div>
      )}
    </div>
  );
}
