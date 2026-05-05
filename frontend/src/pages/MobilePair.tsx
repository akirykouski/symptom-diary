import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";

type Status = "exchanging" | "ok" | "error";

export default function MobilePair() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("exchanging");
  const [error, setError] = useState<string | null>(null);
  // Run the exchange exactly once; React 18 strict mode mounts twice in dev.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setError(t("mobile.pair.failed") ?? "");
      return;
    }
    api
      .exchangeMobilePairToken({ token })
      .then(() => {
        setStatus("ok");
        // Brief delay so the user sees the success state.
        setTimeout(() => navigate("/m/capture", { replace: true }), 700);
      })
      .catch((e: unknown) => {
        setStatus("error");
        if (e instanceof ApiError && e.status === 401) {
          setError(t("mobile.pair.ownerLocked") ?? "");
        } else {
          setError(t("mobile.pair.failed") ?? "");
        }
      });
  }, [params, navigate, t]);

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-ink/5 border border-ink/10 rounded-2xl p-8 text-center space-y-3">
        <h1 className="text-xl font-semibold">{t("mobile.pair.heading")}</h1>
        {status === "exchanging" && (
          <p className="text-ink/60 text-sm">{t("mobile.pair.intro")}</p>
        )}
        {status === "ok" && (
          <p className="text-emerald-300 text-sm">{t("mobile.pair.success")}</p>
        )}
        {status === "error" && (
          <>
            <p className="text-rose-300 text-sm">{error}</p>
            <button
              onClick={() => navigate("/m/capture")}
              className="text-xs text-ink/60 hover:text-ink underline-offset-2 hover:underline"
            >
              {t("mobile.pair.continueAnyway")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
