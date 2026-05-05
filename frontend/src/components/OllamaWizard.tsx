import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OllamaInstallChunk, OllamaSetupMethod, OllamaSetupState } from "../api/client";
import { api, streamOllamaInstall } from "../api/client";

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
    return <div className="text-ink/55 text-sm">{t("ollama.detecting")}</div>;
  }

  const s = setup.data;
  const stepInstallDone = s.binary_present;
  const stepDaemonDone = s.daemon_reachable;

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-ink/45">
        {t("ollama.wizardTitle")}
      </div>

      <Step
        index={1}
        label={t("ollama.step1")}
        done={stepInstallDone}
        detail={
          stepInstallDone
            ? `${t("ollama.binaryFound")} ${s.binary_path ?? ""}`
            : `${t("ollama.platform")}: ${prettyPlatform(s.platform)} · ${s.arch}`
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
      </Step>

      <Step
        index={2}
        label={t("ollama.step2")}
        done={stepDaemonDone}
        detail={
          stepDaemonDone
            ? s.daemon_managed_pid
              ? `${t("ollama.daemonRunning")} (managed pid ${s.daemon_managed_pid})`
              : t("ollama.daemonRunningExternal")
            : s.binary_present
            ? t("ollama.daemonStopped")
            : t("ollama.daemonNeedsBinary")
        }
        disabled={!s.binary_present}
      >
        <div className="flex flex-wrap gap-2">
          {!stepDaemonDone && s.binary_present && (
            <button
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-3 py-1.5 rounded-md text-sm"
            >
              {start.isPending ? t("ollama.starting") : t("ollama.startNow")}
            </button>
          )}
          {stepDaemonDone && s.daemon_managed_pid && (
            <button
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
              className="px-3 py-1.5 rounded-md border border-ink/20 hover:bg-ink/5 text-sm"
            >
              {t("ollama.stopManaged")}
            </button>
          )}
          {start.error && (
            <span className="text-xs text-red-300">
              {(start.error as Error).message}
            </span>
          )}
          {start.data?.reason === "spawn_unreachable" && (
            <span className="text-xs text-amber-300">
              {t("ollama.spawnUnreachable")}
            </span>
          )}
        </div>
      </Step>

      <Step
        index={3}
        label={t("ollama.step3")}
        done={false}
        detail={t("ollama.step3Detail")}
        disabled={!stepDaemonDone}
      />
    </div>
  );
}

function Step({
  index,
  label,
  done,
  detail,
  disabled = false,
  children,
}: {
  index: number;
  label: string;
  done: boolean;
  detail?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        done
          ? "border-emerald-500/30 bg-emerald-500/5"
          : disabled
          ? "border-ink/10 bg-ink/5 opacity-60"
          : "border-amber-500/25 bg-amber-500/5"
      }`}
    >
      <div className="flex items-center gap-3 mb-1">
        <span
          className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
            done
              ? "bg-emerald-500 text-emerald-950"
              : disabled
              ? "bg-ink/20 text-ink/55"
              : "bg-amber-500 text-amber-950"
          }`}
        >
          {done ? "✓" : index}
        </span>
        <div className="font-medium">{label}</div>
      </div>
      {detail && (
        <div className="text-xs text-ink/55 ml-9 mb-2 font-mono break-all">
          {detail}
        </div>
      )}
      {children && <div className="ml-9 mt-2">{children}</div>}
    </div>
  );
}

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
    <div className="space-y-3">
      {state.methods.map((m) => (
        <div key={m.id} className="border border-ink/10 rounded p-3 bg-canvas/30">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-medium flex-1">{m.label}</div>
            {m.auto_runnable ? (
              <button
                onClick={() => onRun(m)}
                disabled={installing}
                className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-3 py-1.5 rounded text-xs font-medium"
              >
                {installing ? t("ollama.installing") : t("ollama.installNow")}
              </button>
            ) : m.url ? (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded border border-ink/20 hover:bg-ink/5 text-xs"
              >
                {t("ollama.openDownload")} ↗
              </a>
            ) : null}
          </div>
          {m.command && (
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 px-2 py-1 bg-ink/8 rounded text-[11px] break-all">
                {m.command}
              </code>
              <button
                onClick={() => copy(m.command!, m.id)}
                className="text-[11px] px-2 py-1 rounded border border-ink/15 hover:bg-ink/5"
              >
                {copied === m.id ? t("ollama.copied") : t("ollama.copy")}
              </button>
            </div>
          )}
          {m.hint && <div className="text-[11px] text-ink/55 mt-1">{m.hint}</div>}
        </div>
      ))}
      {state.methods.length === 0 && (
        <div className="text-xs text-ink/55">
          {t("ollama.noMethods")}{" "}
          {state.download_url && (
            <a
              href={state.download_url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink"
            >
              {t("ollama.openDownload")}
            </a>
          )}
        </div>
      )}

      {(installing || log) && (
        <div className="border border-ink/10 rounded">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/10 bg-ink/5">
            <span className="text-[11px] uppercase text-ink/55">
              {t("ollama.installLog")}
            </span>
            <div className="flex items-center gap-2">
              {installing && (
                <button
                  onClick={onCancel}
                  className="text-[11px] px-2 py-0.5 rounded border border-ink/20 hover:bg-ink/5"
                >
                  {t("ollama.cancel")}
                </button>
              )}
              {exitCode != null && (
                <span
                  className={`text-[11px] ${
                    exitCode === 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  exit {exitCode}
                </span>
              )}
            </div>
          </div>
          <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-auto bg-canvas/30">
            {log || (installing ? "…" : "")}
          </pre>
          {error && <div className="px-3 pb-3 text-xs text-red-300">{error}</div>}
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
