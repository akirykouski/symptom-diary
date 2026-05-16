import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OllamaInstallChunk, OllamaSetupMethod, OllamaSetupState } from "../api/client";
import { api, streamOllamaInstall } from "../api/client";
import { Icons, Pill } from "../ui/clario";

/**
 * 3-step bootstrap wizard the user lands on at /llm:
 *   1. Install the binary  (auto-runnable on macOS+brew, manual elsewhere)
 *   2. Start the daemon    (managed child process)
 *   3. Pull models         (the existing UI below the wizard)
 */
export default function OllamaWizard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const setup = useQuery({
    queryKey: ["ollama", "setup"],
    queryFn: api.ollamaSetup,
    refetchInterval: 4_000,
  });

  const start = useMutation({
    mutationFn: api.ollamaStart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ollama", "setup"] });
      qc.invalidateQueries({ queryKey: ["llm", "status"] });
    },
  });
  const stop = useMutation({
    mutationFn: api.ollamaStop,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ollama", "setup"] });
      qc.invalidateQueries({ queryKey: ["llm", "status"] });
    },
  });

  const [installLog, setInstallLog] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installExitCode, setInstallExitCode] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function runInstall(method: OllamaSetupMethod) {
    if (!method.auto_runnable || !method.id) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setInstalling(true);
    setInstallLog("");
    setInstallError(null);
    setInstallExitCode(null);
    try {
      await streamOllamaInstall(
        method.id,
        (chunk: OllamaInstallChunk) => {
          if (chunk.type === "line" && chunk.text) {
            setInstallLog((prev) => prev + chunk.text);
          } else if (chunk.type === "exit" && typeof chunk.code === "number") {
            setInstallExitCode(chunk.code);
          } else if (chunk.type === "error" && chunk.message) {
            setInstallError(chunk.message);
          }
        },
        ac.signal,
      );
      qc.invalidateQueries({ queryKey: ["ollama", "setup"] });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setInstallError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }

  if (setup.isLoading || !setup.data) {
    return (
      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
        {t("ollama.detecting", "Detecting Ollama…")}
      </div>
    );
  }

  const s = setup.data;
  const stepInstallDone = s.binary_present;
  const stepDaemonDone = s.daemon_reachable;

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <WizardStep
        n={1}
        title={t("ollama.step1", "Install Ollama")}
        done={stepInstallDone}
        active={!stepInstallDone}
        body={
          stepInstallDone
            ? `${t("ollama.binaryFound", "binary found at")} ${s.binary_path ?? ""}`
            : `${t("ollama.platform", "platform")}: ${prettyPlatform(s.platform)} · ${s.arch}`
        }
      >
        {!stepInstallDone && (
          <InstallPanel
            state={s}
            installing={installing}
            log={installLog}
            error={installError}
            exitCode={installExitCode}
            onRun={runInstall}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
      </WizardStep>

      <WizardStep
        n={2}
        title={t("ollama.step2", "Start Ollama")}
        done={stepDaemonDone}
        active={!stepDaemonDone && stepInstallDone}
        disabled={!s.binary_present}
        body={
          stepDaemonDone
            ? s.daemon_managed_pid
              ? `${t("ollama.daemonRunning", "Daemon running")} (managed pid ${s.daemon_managed_pid})`
              : t("ollama.daemonRunningExternal", "Daemon running externally · started outside Clario")
            : s.binary_present
            ? t("ollama.daemonStopped", "Daemon stopped")
            : t("ollama.daemonNeedsBinary", "Install binary first")
        }
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!stepDaemonDone && s.binary_present && (
            <button
              className="btn primary sm"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              {start.isPending
                ? t("ollama.starting", "Starting…")
                : t("ollama.startNow", "Start now")}
            </button>
          )}
          {stepDaemonDone && s.daemon_managed_pid && (
            <button
              className="btn ghost sm"
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
            >
              {t("ollama.stopManaged", "Stop managed daemon")}
            </button>
          )}
          {start.error && (
            <span style={{ fontSize: 11.5, color: "var(--danger)" }}>
              {(start.error as Error).message}
            </span>
          )}
          {start.data?.reason === "spawn_unreachable" && (
            <span style={{ fontSize: 11.5, color: "var(--warn)" }}>
              {t("ollama.spawnUnreachable", "Process started but Ollama did not become reachable.")}
            </span>
          )}
        </div>
      </WizardStep>

      <WizardStep
        n={3}
        title={t("ollama.step3", "Pull AI models")}
        done={false}
        active={stepDaemonDone}
        disabled={!stepDaemonDone}
        body={t("ollama.step3Detail", "gemma3:4b · nomic-embed-text")}
      />
    </ol>
  );
}

/* ─── WizardStep ────────────────────────────────────────────────────── */
function WizardStep({
  n,
  title,
  body,
  done,
  active = false,
  disabled = false,
  children,
}: {
  n: number;
  title: string;
  body?: string;
  done: boolean;
  active?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const bubbleBg = done
    ? "var(--ok)"
    : active
    ? "var(--accent)"
    : "var(--surface-2)";
  const bubbleFg = done || active ? "white" : "var(--ink-3)";

  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: bubbleBg,
          color: bubbleFg,
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {done ? <span style={{ display: "inline-flex", width: 14, height: 14 }}>{Icons.check}</span> : n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{title}</div>
          {done && <Pill tone="ok">complete</Pill>}
          {active && !done && <Pill tone="accent" dot>in progress</Pill>}
        </div>
        {body && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: children ? 8 : 0 }}>
            {body}
          </div>
        )}
        {children && <div style={{ marginTop: 4 }}>{children}</div>}
      </div>
    </li>
  );
}

/* ─── InstallPanel ──────────────────────────────────────────────────── */
function InstallPanel({
  state,
  installing,
  log,
  error,
  exitCode,
  onRun,
  onCancel,
}: {
  state: OllamaSetupState;
  installing: boolean;
  log: string;
  error: string | null;
  exitCode: number | null;
  onRun: (m: OllamaSetupMethod) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {state.methods.map((m) => (
        <div
          key={m.id}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            background: "var(--surface-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: m.command ? 8 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, flex: 1, color: "var(--ink)" }}>{m.label}</div>
            {m.auto_runnable ? (
              <button
                className="btn primary sm"
                onClick={() => onRun(m)}
                disabled={installing}
              >
                {installing
                  ? t("ollama.installing", "Installing…")
                  : t("ollama.installNow", "Install now")}
              </button>
            ) : m.url ? (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="btn sm"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                {Icons.ext}
                {t("ollama.openDownload", "Open download page")}
              </a>
            ) : null}
          </div>
          {m.command && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code
                className="mono"
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: "var(--surface-3)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "var(--ink)",
                  wordBreak: "break-all",
                }}
              >
                {m.command}
              </code>
              <button
                className="btn ghost sm"
                onClick={() => copy(m.command!, m.id)}
              >
                {copied === m.id ? t("ollama.copied", "Copied") : t("ollama.copy", "Copy")}
              </button>
            </div>
          )}
          {m.hint && (
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>{m.hint}</div>
          )}
        </div>
      ))}

      {state.methods.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("ollama.noMethods", "No automatic install method available.")}{" "}
          {state.download_url && (
            <a
              href={state.download_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              {t("ollama.openDownload", "Open download page")}
            </a>
          )}
        </div>
      )}

      {(installing || log) && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-2)",
            }}
          >
            <span
              className="k-label"
              style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              {t("ollama.installLog", "Install log")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {installing && (
                <button className="btn ghost sm" onClick={onCancel}>
                  {t("ollama.cancel", "Cancel")}
                </button>
              )}
              {exitCode != null && (
                <span
                  style={{
                    fontSize: 11,
                    color: exitCode === 0 ? "var(--ok)" : "var(--danger)",
                  }}
                  className="mono"
                >
                  exit {exitCode}
                </span>
              )}
            </div>
          </div>
          <pre
            className="mono"
            style={{
              padding: 12,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              maxHeight: 256,
              overflow: "auto",
              background: "var(--surface)",
              margin: 0,
              color: "var(--ink-2)",
            }}
          >
            {log || (installing ? "…" : "")}
          </pre>
          {error && (
            <div
              style={{
                padding: "6px 12px 10px",
                fontSize: 12,
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function prettyPlatform(p: string): string {
  if (p === "macos") return "macOS";
  if (p === "linux") return "Linux";
  if (p === "windows") return "Windows";
  return p;
}
