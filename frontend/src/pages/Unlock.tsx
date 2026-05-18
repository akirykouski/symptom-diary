import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { AuthShell, BrandLockup, Field, Inline } from "../ui/clario";

export default function Unlock() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (passphrase: string) => api.unlock(passphrase),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setError(t("unlock.errorWrong"));
      } else {
        setError(t("unlock.errorGeneric"));
      }
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pw) {
      setError(t("unlock.errorWrong"));
      return;
    }
    mutation.mutate(pw);
  }

  return (
    <AuthShell>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <BrandLockup />
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>
        {t("unlock.heading")}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink-2)" }}>
        Enter your passphrase to unlock the journal. Nothing on this screen leaves your device.
      </p>
      <form onSubmit={submit} style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("unlock.passphraseLabel")}>
          <input
            className="input"
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {error && <Inline tone="danger">{error}</Inline>}
        <button
          type="submit"
          className="btn primary"
          disabled={mutation.isPending}
          style={{ height: 40, justifyContent: "center" }}
        >
          {mutation.isPending ? t("unlock.unlocking") : t("unlock.submit")}
        </button>
      </form>
      <div style={{ marginTop: 18, fontSize: 11.5, color: "var(--ink-3)", textAlign: "center" }}>
        No recovery. If you forget the passphrase the data is gone.
      </div>
    </AuthShell>
  );
}
