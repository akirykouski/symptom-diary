import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";

export default function Setup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"setup" | "import">("setup");

  const mutation = useMutation({
    mutationFn: (passphrase: string) => api.setup(passphrase),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 422) {
        setError(t("setup.errorTooShort"));
      } else {
        setError(t("setup.errorGeneric"));
      }
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

  return (
    <CenterShell>
      {mode === "setup" ? (
        <>
          <h1 className="text-2xl font-semibold mb-2">{t("setup.heading")}</h1>
          <p className="text-ink/60 text-sm mb-6">{t("setup.intro")}</p>
          <form onSubmit={submit} className="space-y-4">
            <Field
              label={t("setup.passphraseLabel")}
              value={pw}
              onChange={setPw}
              autoFocus
            />
            <Field
              label={t("setup.confirmLabel")}
              value={confirm}
              onChange={setConfirm}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium transition"
            >
              {mutation.isPending ? t("setup.creating") : t("setup.submit")}
            </button>
          </form>
          <button
            onClick={() => setMode("import")}
            className="mt-6 w-full text-xs text-ink/55 hover:text-ink/85 underline-offset-2 hover:underline"
            type="button"
          >
            {t("bundle.importToggle")}
          </button>
        </>
      ) : (
        <ImportBundleForm onCancel={() => setMode("setup")} />
      )}
    </CenterShell>
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth", "status"] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setError(t("bundle.errorWrongPassphrase"));
      } else {
        setError(t("bundle.errorBadBundle"));
      }
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
      <h1 className="text-2xl font-semibold mb-2">{t("bundle.importHeading")}</h1>
      <p className="text-ink/60 text-sm mb-6">{t("bundle.importIntro")}</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="block text-sm text-ink/70 mb-1">{t("bundle.importFile")}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".diary,application/x-symptom-diary"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-accent file:text-white file:hover:bg-accent/90 file:cursor-pointer"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-ink/70 mb-1">{t("bundle.importPassphrase")}</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
          />
        </label>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {importMutation.isSuccess && (
          <p className="text-emerald-300 text-sm">
            {t("bundle.importDone", { entries: importMutation.data.entries })}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-ink/20 hover:bg-ink/5 text-sm"
          >
            {t("bundle.importCancel")}
          </button>
          <button
            type="submit"
            disabled={importMutation.isPending || !file || !passphrase}
            className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium transition"
          >
            {importMutation.isPending ? t("bundle.importing") : t("bundle.importSubmit")}
          </button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-ink/70 mb-1">{label}</span>
      <input
        type="password"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
      />
    </label>
  );
}

function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-sm bg-ink/5 border border-ink/10 rounded-xl p-8">
        {children}
      </div>
    </div>
  );
}
