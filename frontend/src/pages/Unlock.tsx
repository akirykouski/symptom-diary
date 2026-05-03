import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";

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
    if (!pw) return;
    mutation.mutate(pw);
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-sm bg-ink/5 border border-ink/10 rounded-xl p-8">
        <h1 className="text-2xl font-semibold mb-6">{t("unlock.heading")}</h1>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-sm text-ink/70 mb-1">
              {t("unlock.passphraseLabel")}
            </span>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
            />
          </label>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium transition"
          >
            {mutation.isPending ? t("unlock.unlocking") : t("unlock.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
