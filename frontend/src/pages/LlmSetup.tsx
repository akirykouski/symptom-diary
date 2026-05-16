import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, streamPull } from "../api/client";
import type { PullChunk } from "../api/client";
import OllamaWizard from "../components/OllamaWizard";
import { Icons, Pill, ScreenHeader } from "../ui/clario";

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

  const daemonPill = status.isLoading ? (
    <Pill tone="neutral">{t("llm.checking", "Checking…")}</Pill>
  ) : status.data?.ollama ? (
    <Pill tone="ok" dot>
      {t("llm.ollamaUp", "daemon reachable at")} {status.data.url}
    </Pill>
  ) : (
    <Pill tone="warn" dot>
      {t("llm.ollamaDown", "daemon unreachable at")} {status.data?.url ?? "localhost:11434"}
    </Pill>
  );

  return (
    <>
      <ScreenHeader
        title={t("llm.title", "AI models · Ollama")}
        sub={t(
          "llm.intro",
          "Everything runs locally on your machine — no model API calls leave the network.",
        )}
        actions={daemonPill}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 28px" }}>
        {/* Bootstrap wizard */}
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div className="k-label" style={{ marginBottom: 12 }}>
            {t("ollama.wizardTitle", "Bootstrap (3 steps)")}
          </div>
          <OllamaWizard />
        </div>

        {/* Model cards grid */}
        {status.data && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 18,
            }}
          >
            {Object.entries(status.data.models).map(([modelName, installed]) => {
              const purpose = modelName === status.data!.installed?.[0]
                ? t("llm.extractor", "Entity extractor & rationale writer")
                : modelName.includes("embed")
                ? t("llm.embedder", "Embeddings for canonical entity matching")
                : t("llm.modelLabel", "AI model");
              return (
                <ModelCard
                  key={modelName}
                  name={modelName}
                  purpose={purpose}
                  installed={installed}
                  ollamaUp={status.data!.ollama}
                  pull={pull}
                  onPull={() => startPull(modelName)}
                  onCancel={() => abortRef.current?.abort()}
                />
              );
            })}
          </div>
        )}

        {/* Custom model pull */}
        <div
          className="card"
          style={{
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="k-label">{t("llm.customModel", "Custom model")}</span>
          <input
            className="input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. llama3.2:3b"
            style={{ flex: 1, maxWidth: 360 }}
          />
          <button
            className="btn primary"
            onClick={() => custom.trim() && startPull(custom.trim())}
            disabled={!custom.trim() || !status.data?.ollama}
          >
            {t("llm.customPull", "Pull custom model")}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── ModelCard ─────────────────────────────────────────────────────── */
function ModelCard({
  name,
  purpose,
  installed,
  ollamaUp,
  pull,
  onPull,
  onCancel,
}: {
  name: string;
  purpose: string;
  installed: boolean;
  ollamaUp: boolean;
  pull: PullState | null;
  onPull: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isActive = pull != null && pull.model === name && !pull.done;
  const isDone = pull != null && pull.model === name && pull.done;
  const pct =
    pull != null && pull.model === name && pull.total
      ? Math.min(100, Math.round(((pull.completed ?? 0) / pull.total) * 100))
      : null;

  const cardStatus: "installed" | "pulling" | "missing" = isActive
    ? "pulling"
    : installed
    ? "installed"
    : "missing";

  const progressPct = cardStatus === "installed" ? 100 : pct ?? 0;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{purpose}</div>
        </div>
        {cardStatus === "installed" && <Pill tone="ok">{t("llm.modelInstalled", "installed")}</Pill>}
        {cardStatus === "missing" && <Pill tone="neutral">{t("llm.modelMissing", "not installed")}</Pill>}
        {cardStatus === "pulling" && (
          <Pill tone="accent" dot>
            {t("llm.pulling", "pulling")} {pct != null ? `${pct}%` : ""}
          </Pill>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          marginTop: 10,
          height: 4,
          borderRadius: 999,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 200ms",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {pull?.model === name && pull.status && !isDone
            ? pull.status
            : pull?.model === name && isDone && !pull.error
            ? t("llm.pullDone", "complete")
            : pull?.model === name && pull.error
            ? pull.error
            : ""}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {cardStatus === "missing" && (
            <button
              className="btn sm primary"
              onClick={onPull}
              disabled={!ollamaUp}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              {Icons.download}
              {t("llm.pullModel", "Pull")}
            </button>
          )}
          {cardStatus === "pulling" && (
            <button className="btn sm" onClick={onCancel}>
              {t("llm.pullCancel", "Cancel")}
            </button>
          )}
          {cardStatus === "installed" && (
            <button className="btn ghost sm" disabled style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {Icons.check}
              {t("llm.modelInstalled", "installed")}
            </button>
          )}
        </div>
      </div>

      {pull?.model === name && pull.error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11.5,
            color: "var(--danger)",
            background: "var(--danger-tint)",
            borderRadius: 6,
            padding: "4px 8px",
          }}
        >
          {t("llm.pullError", "Error")}: {pull.error}
        </div>
      )}
    </div>
  );
}
