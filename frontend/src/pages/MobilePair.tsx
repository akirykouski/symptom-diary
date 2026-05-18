import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Icons } from "../ui/clario";

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
      setError(t("mobile.pair.failed", "Pairing failed — invalid link.") ?? "");
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
          setError(t("mobile.pair.ownerLocked", "The journal is currently locked. Ask the owner to unlock it and try again.") ?? "");
        } else {
          setError(t("mobile.pair.failed", "Pairing failed — the link may have expired.") ?? "");
        }
      });
  }, [params, navigate, t]);

  /* progress bar width */
  const progress = status === "exchanging" ? "55%" : status === "ok" ? "100%" : "30%";
  const progressColor =
    status === "ok" ? "var(--ok)" : status === "error" ? "var(--danger)" : "var(--accent)";

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Geist, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "32px 24px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          boxShadow: "var(--shadow-2)",
        }}
      >
        {/* Icon circle */}
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 999,
            background:
              status === "ok"
                ? "var(--ok-tint)"
                : status === "error"
                  ? "var(--danger-tint)"
                  : "var(--accent-tint)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color:
              status === "ok"
                ? "var(--ok)"
                : status === "error"
                  ? "var(--danger)"
                  : "var(--accent)",
          }}
        >
          {status === "ok"
            ? Icons.check
            : status === "error"
              ? Icons.alert
              : Icons.shield}
        </div>

        {/* Heading */}
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
          {t("mobile.pair.heading", "Pairing this phone")}
        </h1>

        {/* Status text */}
        {status === "exchanging" && (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>
            {t("mobile.pair.intro", "Verifying the pairing token…")}
          </p>
        )}
        {status === "ok" && (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ok)" }}>
            {t("mobile.pair.success", "Paired! Launching capture…")}
          </p>
        )}
        {status === "error" && (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--danger)" }}>{error}</p>
        )}

        {/* Progress bar */}
        <div
          style={{
            height: 4,
            width: "100%",
            borderRadius: 999,
            background: "var(--surface-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: progress,
              height: "100%",
              background: progressColor,
              transition: "width 0.4s ease, background 0.3s ease",
            }}
          />
        </div>

        {/* Error actions */}
        {status === "error" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <button
              onClick={() => navigate("/m/capture")}
              className="btn ghost sm"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <span style={{ display: "inline-flex" }}>{Icons.retry}</span>
              {t("mobile.pair.continueAnyway", "Continue to capture anyway")}
            </button>
          </div>
        )}

        {/* Bottom caption */}
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <span style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}>
            {Icons.shield}
          </span>
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)", textAlign: "left", lineHeight: 1.5 }}>
            LAN-only. Nothing leaves your home network.
          </p>
        </div>
      </div>
    </div>
  );
}
