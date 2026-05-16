import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobilePairToken, MobileSession, api } from "../api/client";
import { Icons, Modal } from "../ui/clario";

const TTL_OPTIONS = [5, 10, 20, 30];

export default function PairPhoneModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ttl, setTtl] = useState(10);
  const [label, setLabel] = useState("phone");

  const sessions = useQuery({
    queryKey: ["mobile", "sessions"],
    queryFn: api.listMobileSessions,
    refetchInterval: 5_000,
  });

  const mint = useMutation({
    mutationFn: () => api.mintMobilePairToken({ ttl_minutes: ttl, label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile", "sessions"] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeMobileSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile", "sessions"] }),
  });

  return (
    <Modal onClose={onClose} width={620}>
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
            {t("pair.modalTitle", "Pair a phone for capture")}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
            {t(
              "pair.intro",
              "Scan with a phone on the same WiFi. The phone lands on a focused capture page; photos upload straight into the journal, encrypted on arrival.",
            )}
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
          gridTemplateColumns: mint.data ? "220px 1fr" : "1fr",
          gap: 24,
        }}
      >
        {mint.data ? (
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
              <img src={mint.data.qr_data_url} alt="pair-qr" style={{ width: 168, height: 168 }} />
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                scoped: capture / write-only
              </div>
            </div>

            {/* Token info column */}
            <ActiveQr token={mint.data} onReset={() => mint.reset()} />
          </>
        ) : (
          /* Form */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "var(--ink-2)",
                    marginBottom: 6,
                  }}
                >
                  {t("pair.label", "Label")}
                </span>
                <input
                  className="input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  style={{ fontSize: 12.5 }}
                />
              </label>

              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "var(--ink-2)",
                    marginBottom: 6,
                  }}
                >
                  {t("pair.ttlLabel", "Link valid for")}
                </span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {TTL_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTtl(n)}
                      style={{
                        height: 30,
                        padding: "0 12px",
                        borderRadius: 999,
                        cursor: "pointer",
                        background: ttl === n ? "var(--accent-tint)" : "var(--surface)",
                        color: ttl === n ? "var(--accent-strong)" : "var(--ink-2)",
                        border:
                          "1px solid " +
                          (ttl === n
                            ? "color-mix(in oklch, var(--accent) 30%, var(--border))"
                            : "var(--border)"),
                        fontSize: 12,
                        fontWeight: ttl === n ? 600 : 500,
                      }}
                    >
                      {t("pair.ttlMinutes", "{{count}} min", { count: n })}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            <button
              onClick={() => mint.mutate()}
              disabled={mint.isPending}
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
            >
              <span style={{ display: "inline-flex" }}>{Icons.qr}</span>
              {mint.isPending
                ? t("pair.minting", "Generating…")
                : t("pair.mintButton", "Generate pairing QR")}
            </button>
          </div>
        )}
      </div>

      {/* Sessions panel */}
      <SessionsPanel
        sessions={sessions.data?.sessions ?? []}
        onRevoke={(id) => revoke.mutate(id)}
        isRevoking={revoke.isPending}
      />

      {/* Footer */}
      <div style={{ padding: "0 24px 20px", fontSize: 11, color: "var(--ink-4)" }}>
        {t("pair.lockNote", "When the journal locks, all paired phones immediately lose write access.")}
      </div>
    </Modal>
  );
}

function ActiveQr({ token, onReset }: { token: MobilePairToken; onReset: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secondsLeft = Math.max(
    0,
    Math.floor((new Date(token.expires_at).getTime() - now) / 1000),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!token.lan_ok && (
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
          {t("pair.lanWarning", "Not on the same WiFi — the phone may not reach this machine.")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>
            {t("pair.expiresIn", "Expires in {{seconds}}s", { seconds: secondsLeft })}
          </span>
          <button
            onClick={onReset}
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {t("pair.regenerate", "Regenerate")}
          </button>
        </div>
        <div>
          <span style={{ color: "var(--ink-3)", marginRight: 4 }}>{t("pair.url", "URL")}:</span>
          <a
            href={token.url}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{ color: "var(--accent)", wordBreak: "break-all", fontSize: 11.5 }}
          >
            {token.url}
          </a>
        </div>
      </div>
    </div>
  );
}

function SessionsPanel({
  sessions,
  onRevoke,
  isRevoking,
}: {
  sessions: MobileSession[];
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        margin: "0 24px 16px",
        padding: 14,
        borderRadius: 10,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sessions.length > 0 ? 10 : 0 }}>
        <b style={{ fontSize: 12.5, color: "var(--ink)" }}>
          {t("pair.sessionsHeading", "Paired phones:")}
        </b>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {sessions.length === 0
            ? t("pair.sessionsEmpty", "none yet")
            : `${sessions.length} active`}
        </span>
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ display: "inline-flex", color: "var(--ink-3)" }}>{Icons.mobile}</span>
          <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink)" }}>{s.label}</span>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{s.fetches} req</span>
          <button
            disabled={isRevoking}
            onClick={() => onRevoke(s.id)}
            className="btn ghost sm"
            style={{ color: "var(--danger)", padding: "0 8px" }}
          >
            {t("pair.revoke", "Revoke")}
          </button>
        </div>
      ))}
    </div>
  );
}
