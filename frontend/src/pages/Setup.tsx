import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { AuthShell, BrandLockup, Field, Icons, Inline } from "../ui/clario";

export default function Setup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"setup" | "import">("setup");

  const strength = useMemo(() => {
    if (!pw) return { score: 0, label: "—", color: "var(--ink-4)" };
    let s = 0;
    if (pw.length >= 12) s++;
    if (pw.length >= 18) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    const labels = ["too short", "weak", "ok", "strong", "very strong", "excellent"];
    const colors = [
      "var(--danger)",
      "var(--danger)",
      "var(--warn)",
      "var(--ok)",
      "var(--ok)",
      "var(--ok)",
    ];
    return { score: s, label: labels[s], color: colors[s] };
  }, [pw]);

  const mutation = useMutation({
    mutationFn: (passphrase: string) => api.setup(passphrase),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 422) setError(t("setup.errorTooShort"));
      else setError(t("setup.errorGeneric"));
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 12) {
      setError(t("setup.errorTooShort"));
      return;
    }
    if (pw !== confirm) {
      setError(t("setup.errorMismatch"));
      return;
    }
    mutation.mutate(pw);
  }

  if (mode === "import") {
    return (
      <AuthShell>
        <ImportBundleForm onCancel={() => setMode("setup")} />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <BrandLockup />
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>
        {t("setup.heading")}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        Your journal is encrypted on this device only.{" "}
        <b style={{ color: "var(--ink)" }}>If you forget this passphrase the data is gone</b> — there
        is no cloud and no reset.
      </p>
      <form onSubmit={submit} style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("setup.passphraseLabel")} hint="Minimum 12 characters">
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          {pw && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 999,
                  background: "var(--surface-3)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(strength.score / 5) * 100}%`,
                    height: "100%",
                    background: strength.color,
                    transition: "width .25s",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  color: strength.color,
                  fontWeight: 500,
                  minWidth: 80,
                  textAlign: "right",
                }}
              >
                {strength.label}
              </span>
            </div>
          )}
        </Field>
        <Field label={t("setup.confirmLabel")}>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && <Inline tone="danger">{error}</Inline>}
        <button
          type="submit"
          className="btn primary"
          disabled={mutation.isPending}
          style={{ height: 40, justifyContent: "center", marginTop: 4 }}
        >
          {mutation.isPending ? t("setup.creating") : t("setup.submit")}
        </button>
      </form>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 12,
          background: "var(--surface-2)",
          borderRadius: 10,
          fontSize: 12,
          color: "var(--ink-2)",
        }}
      >
        <span style={{ color: "var(--accent)", display: "inline-flex" }}>{Icons.shield}</span>
        <span>SQLCipher (AES-256) · Argon2id key derivation · auto-lock after 15 min idle</span>
      </div>
      <button
        type="button"
        onClick={() => setMode("import")}
        className="btn ghost sm"
        style={{ width: "100%", justifyContent: "center", marginTop: 14, height: 30 }}
      >
        {t("bundle.importToggle")}
      </button>
    </AuthShell>
  );
}

function ImportBundleForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: ({ f, p }: { f: File; p: string }) => api.bundleImport(f, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) setError(t("bundle.errorWrongPassphrase"));
      else setError(t("bundle.errorBadBundle"));
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError(t("bundle.errorBadBundle"));
      return;
    }
    if (!passphrase) {
      setError(t("bundle.errorWrongPassphrase"));
      return;
    }
    importMutation.mutate({ f: file, p: passphrase });
  }

  return (
    <>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <BrandLockup />
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>
        {t("bundle.importHeading")}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("bundle.importIntro")}
      </p>
      <form onSubmit={submit} style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("bundle.importFile")}>
          <input
            ref={fileRef}
            type="file"
            accept=".diary,application/x-symptom-diary"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input"
            style={{ paddingTop: 7 }}
          />
        </Field>
        <Field label={t("bundle.importPassphrase")}>
          <input
            className="input"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </Field>
        {error && <Inline tone="danger">{error}</Inline>}
        {importMutation.isSuccess && (
          <Inline tone="info">
            {t("bundle.importDone", { entries: importMutation.data.entries })}
          </Inline>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onCancel} className="btn" style={{ height: 40 }}>
            {t("bundle.importCancel")}
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={importMutation.isPending || !file || !passphrase}
            style={{ flex: 1, justifyContent: "center", height: 40 }}
          >
            {importMutation.isPending ? t("bundle.importing") : t("bundle.importSubmit")}
          </button>
        </div>
      </form>
    </>
  );
}
