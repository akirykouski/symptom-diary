import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, QrSession } from "../api/client";
import { Icons, Modal } from "../ui/clario";

const TTL_OPTIONS = [5, 10, 20, 30];

export default function QrShareModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ttl, setTtl] = useState(10);

  const sessions = useQuery({
    queryKey: ["qrShare", "list"],
    queryFn: api.listQrSessions,
    refetchInterval: 5_000,
  });

  const create = useMutation({
    mutationFn: () => api.createQrSession({ ttl_minutes: ttl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qrShare", "list"] }),
  });

  const revoke = useMutation({
    mutationFn: (token: string) => api.revokeQrSession(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qrShare", "list"] });
      create.reset();
    },
  });

  const active = create.data ?? null;

  return (
    <Modal onClose={onClose} width={580}>
      {/* Header */}
      <div
        style={{
          padding: "20px 24px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
            {t("qr.modalTitle", "Share with clinician via QR")}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
            {t("qr.intro", "Read-only · expires in {{minutes}} min · invalidated the moment you lock the journal", { minutes: ttl })}
          </div>
        </div>
        <button
          onClick={onClose}
          className="btn ghost sm"
          style={{ padding: "0 8px", marginTop: -2 }}
          aria-label="close"
        >
          {Icons.x}
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: active ? "220px 1fr" : "1fr",
          gap: 24,
        }}
      >
        {active ? (
          <>
            {/* QR column */}
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: "white",
                border: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <img src={active.qr_data_url} alt="QR" style={{ width: 168, height: 168 }} />
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                scoped: brief / read-only
              </div>
            </div>

            {/* Info column */}
            <ActiveSession
              session={active}
              onRevoke={() => revoke.mutate(active.token)}
              isRevoking={revoke.isPending}
            />
          </>
        ) : (
          /* Creation form */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)", marginBottom: 8 }}>
                {t("qr.ttlLabel", "Link valid for")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {TTL_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setTtl(n)}
                    style={{
                      height: 30,
                      padding: "0 14px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: ttl === n ? "var(--accent-tint)" : "var(--surface)",
                      color: ttl === n ? "var(--accent-strong)" : "var(--ink-2)",
                      border:
                        "1px solid " +
                        (ttl === n
                          ? "color-mix(in oklch, var(--accent) 30%, var(--border))"
                          : "var(--border)"),
                      fontSize: 12.5,
                      fontWeight: ttl === n ? 600 : 500,
                    }}
                  >
                    {t("qr.ttlMinutes", "{{count}} min", { count: n })}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
            >
              <span style={{ display: "inline-flex" }}>{Icons.qr}</span>
              {create.isPending ? t("qr.creating", "Generating…") : t("qr.createBtn", "Generate QR link")}
            </button>

            {/* Existing sessions */}
            {sessions.data && sessions.data.sessions.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div className="k-label" style={{ marginBottom: 8 }}>
                  Active sessions
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  {sessions.data.sessions.map((s) => (
                    <li
                      key={s.token}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        fontSize: 12,
                        gap: 8,
                      }}
                    >
                      <span className="mono" style={{ flex: 1, color: "var(--ink-2)" }}>
                        …{s.token.slice(-8)}
                      </span>
                      <span style={{ color: "var(--ink-3)" }}>
                        {t("qr.fetches", "{{count}} fetches", { count: s.fetches })}
                      </span>
                      <button
                        onClick={() => revoke.mutate(s.token)}
                        className="btn ghost sm"
                        style={{ color: "var(--danger)", padding: "0 6px" }}
                      >
                        {Icons.x}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div
        style={{
          padding: "0 24px 20px",
          fontSize: 11,
          color: "var(--ink-4)",
        }}
      >
        {t("qr.noteLocked", "The session is immediately invalidated when the journal is locked.")}
      </div>
    </Modal>
  );
}

function ActiveSession({
  session,
  onRevoke,
  isRevoking,
}: {
  session: QrSession;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expiresAt = new Date(session.expires_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!session.lan_ok && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--warn-tint)",
            border: "1px solid color-mix(in oklch, var(--warn) 30%, var(--border))",
            fontSize: 12,
            color: "oklch(48% 0.12 75)",
          }}
        >
          {t("qr.lanWarning", "Not on the same WiFi — the phone may not reach this machine.")}
        </div>
      )}

      {/* Status row */}
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12.5,
          color: "var(--ink-2)",
        }}
      >
        <span style={{ color: "var(--accent)", display: "inline-flex" }}>{Icons.shield}</span>
        <span>
          <b style={{ color: "var(--ink)" }}>
            {t("qr.fetches", "Opened {{count}} times.", { count: session.fetches })}
          </b>{" "}
          {t("qr.expiresIn", "Expires in", { seconds: secondsLeft })}{" "}
          <span className="mono">
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
        </span>
        <button
          onClick={onRevoke}
          disabled={isRevoking}
          className="btn danger sm"
          style={{ marginLeft: "auto" }}
        >
          {isRevoking ? t("qr.revoking", "Revoking…") : t("qr.revoke", "Revoke now")}
        </button>
      </div>

      {/* URL */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("qr.url", "URL")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            className="input mono"
            value={session.url}
            readOnly
            style={{ fontSize: 12, flex: 1 }}
          />
          <button
            className="btn sm"
            onClick={() => void navigator.clipboard?.writeText(session.url)}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
