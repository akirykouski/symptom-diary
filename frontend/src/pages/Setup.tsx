import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";

export default function Setup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    </CenterShell>
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
