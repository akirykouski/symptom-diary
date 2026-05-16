import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobilePairToken, MobileSession, api } from "../api/client";
import { Icons, Pill, ScreenHeader, Tab } from "../ui/clario";

const TTL_OPTIONS = [5, 10, 20, 30];

/* ─── Phone frame (desktop preview) ──────────────────────────────────── */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 308,
        height: 628,
        borderRadius: 40,
        padding: 7,
        background: "oklch(18% 0.005 250)",
        boxShadow: "0 18px 60px rgba(20,28,40,0.25), 0 0 0 1px rgba(20,28,40,0.18)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 33,
          background: "var(--bg)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* dynamic island */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 86,
            height: 25,
            borderRadius: 16,
            background: "oklch(12% 0.005 250)",
            zIndex: 30,
          }}
        />
        {/* status bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            padding: "12px 22px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--ink)",
          }}
        >
          <span className="mono" style={{ fontWeight: 600 }}>
            9:41
          </span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <svg width="13" height="9" viewBox="0 0 14 10">
              <path d="M0 7h2v3H0zm4-2h2v5H4zm4-3h2v8H8zm4-3h2v11h-2z" fill="currentColor" />
            </svg>
            <svg width="18" height="9" viewBox="0 0 20 10">
              <rect x="0.5" y="0.5" width="16" height="9" rx="2" fill="none" stroke="currentColor" />
              <rect x="1.5" y="1.5" width="14" height="7" rx="1" fill="currentColor" />
            </svg>
          </div>
        </div>
        {/* content */}
        <div style={{ position: "absolute", inset: 0, paddingTop: 42 }}>{children}</div>
        {/* home indicator */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 110,
            height: 4,
            borderRadius: 999,
            background: "oklch(85% 0.005 250)",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Capture preview (in-frame) ─────────────────────────────────────── */
function CapturePreview({ shot, onToggleShot }: { shot: boolean; onToggleShot: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "2px 14px 28px",
      }}
    >
      {/* mini header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 12h4l2-5 4 10 2-5h4" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
            {t("mobile.capture.heading", "Clario · capture")}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--ok)" }}>
            {t("mobile.capture.online", "● Connected")}
          </div>
        </div>
      </div>

      {/* viewfinder */}
      <div
        style={{
          flex: 1,
          marginTop: 8,
          borderRadius: 14,
          overflow: "hidden",
          background: shot
            ? "linear-gradient(135deg, oklch(60% 0.13 30) 0%, oklch(70% 0.08 75) 100%)"
            : "var(--surface-2)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 10.5,
          position: "relative",
          minHeight: 0,
        }}
      >
        {!shot ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, color: "var(--ink-4)" }}>📷</div>
            <div style={{ marginTop: 4 }}>
              {t("mobile.capture.tapShutter", "Tap shutter to take a photo")}
            </div>
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, padding: 12, color: "white" }}>
            <div style={{ fontSize: 9.5, opacity: 0.8 }}>2026-05-16 · 11:42</div>
            <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600 }}>
              captured · ready to send
            </div>
          </div>
        )}
      </div>

      {/* note area */}
      <textarea
        readOnly
        value=""
        placeholder={t("mobile.capture.notePlaceholder", "Optional note — what's happening?") ?? ""}
        rows={2}
        style={{
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          fontSize: 11.5,
          resize: "none",
          fontFamily: "inherit",
          color: "var(--ink)",
          background: "var(--surface)",
          outline: "none",
        }}
      />

      {/* shutter + save row */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={onToggleShot}
          style={{
            width: 46,
            height: 46,
            borderRadius: 999,
            cursor: "pointer",
            background: "white",
            border: "3px solid oklch(20% 0.005 250)",
            boxShadow: "0 0 0 3px white, 0 0 0 5px oklch(20% 0.005 250)",
            flexShrink: 0,
          }}
        />
        <button
          disabled={!shot}
          className="btn primary"
          style={{ flex: 1, height: 38, justifyContent: "center", opacity: shot ? 1 : 0.45, fontSize: 12 }}
        >
          {shot
            ? t("mobile.capture.save", "Save & sync")
            : t("mobile.capture.tapShutter", "Take photo first")}
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: "var(--ink-3)", textAlign: "center", lineHeight: 1.4 }}>
        {t("mobile.capture.privacyNote", "Encrypted on the desktop the moment they arrive.")}
      </div>
    </div>
  );
}

/* ─── Pair preview (in-frame) ─────────────────────────────────────────── */
function PairPreview() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          marginTop: 20,
          background: "var(--accent-tint)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent)",
        }}
      >
        {Icons.shield}
      </div>
      <div style={{ marginTop: 14, fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
        {t("mobile.pair.heading", "Pairing this phone")}
      </div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-2)" }}>
        {t("mobile.pair.intro", "Verifying the pairing token…")}
      </div>
      <div
        style={{
          marginTop: 24,
          height: 4,
          width: 200,
          borderRadius: 999,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "60%", height: "100%", background: "var(--accent)" }} />
      </div>
      <div style={{ marginTop: "auto", fontSize: 10.5, color: "var(--ink-3)" }}>
        Desktop is unlocked
      </div>
    </div>
  );
}

/* ─── Active QR section (pairing panel) ─────────────────────────────── */
function ActiveQrPanel({ token, onReset }: { token: MobilePairToken; onReset: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((new Date(token.expires_at).getTime() - now) / 1000));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!token.lan_ok && (
        <div
          style={{
            padding: 10,
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
        <img src={token.qr_data_url} alt="pair-qr" style={{ width: 168, height: 168 }} />
        <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          scoped: capture / write-only
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>
            {t("pair.expiresIn", "Expires in {{seconds}}s", { seconds: secondsLeft })}
          </span>
          <button
            onClick={onReset}
            style={{
              fontSize: 11.5,
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

/* ─── Sessions list ───────────────────────────────────────────────────── */
function SessionsList({
  sessions,
  onRevoke,
  isRevoking,
}: {
  sessions: MobileSession[];
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}) {
  const { t } = useTranslation();
  if (sessions.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)", paddingTop: 4 }}>
        {t("pair.sessionsEmpty", "No paired phones yet.")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sessions.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
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

/* ─── Pairing panel ───────────────────────────────────────────────────── */
function PairingPanel() {
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
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="k-label" style={{ marginBottom: 6 }}>
          {t("pair.modalTitle", "Pair a phone")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
          {t(
            "pair.intro",
            "Scan with a phone on the same WiFi. Photos upload straight into the journal, encrypted on arrival.",
          )}
        </div>
      </div>

      {!mint.data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
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
              <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
                {t("pair.ttlLabel", "Link valid for")}
              </span>
              <select
                className="input"
                value={ttl}
                onChange={(e) => setTtl(parseInt(e.target.value, 10))}
                style={{ fontSize: 12.5 }}
              >
                {TTL_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {t("pair.ttlMinutes", "{{count}} min", { count: n })}
                  </option>
                ))}
              </select>
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
      ) : (
        <ActiveQrPanel token={mint.data} onReset={() => mint.reset()} />
      )}

      {/* Active sessions */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div className="k-label" style={{ marginBottom: 8 }}>
          {t("pair.sessionsHeading", "Paired phones")}
          {sessions.data && sessions.data.sessions.length > 0 && (
            <span
              className="mono"
              style={{
                marginLeft: 6,
                fontSize: 10.5,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--accent-tint)",
                color: "var(--accent-strong)",
              }}
            >
              {sessions.data.sessions.length}
            </span>
          )}
        </div>
        <SessionsList
          sessions={sessions.data?.sessions ?? []}
          onRevoke={(id) => revoke.mutate(id)}
          isRevoking={revoke.isPending}
        />
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <span style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}>
          {Icons.shield}
        </span>
        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
          <b style={{ color: "var(--ink)" }}>
            {t("pair.lockNote", "Nothing leaves your home network.")}
          </b>{" "}
          Photos are encrypted by libsodium secretstream on the desktop before they hit disk.
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */
export default function MobileCompanion() {
  const { t } = useTranslation();
  const [view, setView] = useState<"capture" | "pair">("capture");
  const [shot, setShot] = useState(false);

  const sessions = useQuery({
    queryKey: ["mobile", "sessions"],
    queryFn: api.listMobileSessions,
    refetchInterval: 10_000,
  });

  const pairedCount = sessions.data?.sessions.length ?? 0;

  return (
    <>
      <ScreenHeader
        title={t("nav.mobile", "Mobile companion")}
        sub={t(
          "mobile.companion.sub",
          "A focused PWA your phone opens after scanning the pairing QR. Drafts queue offline when the LAN drops.",
        )}
        tabs={
          <>
            <Tab active={view === "capture"} onClick={() => setView("capture")}>
              {t("mobile.tab.capture", "Capture")}
            </Tab>
            <Tab active={view === "pair"} onClick={() => setView("pair")}>
              {t("mobile.tab.pairing", "Pairing")}
            </Tab>
          </>
        }
        actions={<Pill tone="ok" dot>{t("mobile.companion.pill", "encrypted on arrival")}</Pill>}
      />

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 28px 28px",
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 28,
          alignItems: "flex-start",
        }}
      >
        {/* Left: explanation + stats + pairing */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* How it works */}
          <div className="card" style={{ padding: 22 }}>
            <div className="k-label" style={{ marginBottom: 6 }}>
              {t("mobile.companion.howItWorks", "How it works")}
            </div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13.5,
                color: "var(--ink-2)",
                lineHeight: 1.7,
              }}
            >
              <li>
                On the desktop, open <b>Pairing</b> tab and pick a TTL.
              </li>
              <li>
                Scan the QR with your phone — the camera lands you on a focused capture page over LAN,
                never the internet.
              </li>
              <li>
                Take a photo (and optionally a note). It uploads straight into the desktop journal,
                where it is encrypted before being written to disk.
              </li>
              <li>
                If WiFi drops, the page queues drafts in IndexedDB and replays them the moment the
                desktop is reachable again.
              </li>
              <li>
                When you <b>lock</b> the journal, every paired phone loses write access immediately.
              </li>
            </ol>
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 4 }}>
                {t("mobile.stat.paired", "Paired phones")}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)" }}>{pairedCount}</div>
              <div style={{ fontSize: 12, color: pairedCount > 0 ? "var(--accent)" : "var(--ink-4)", marginTop: 2 }}>
                {pairedCount === 0
                  ? t("mobile.stat.noPaired", "none yet")
                  : `${pairedCount} active`}
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 4 }}>
                {t("mobile.stat.outbox", "Outbox drafts")}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)" }}>0</div>
              <div style={{ fontSize: 12, color: "var(--ok)", marginTop: 2 }}>
                {t("mobile.stat.delivered", "all delivered")}
              </div>
            </div>
          </div>

          {/* Pairing panel */}
          <PairingPanel />
        </div>

        {/* Right: iPhone frame */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
          <PhoneFrame>
            {view === "capture" ? (
              <CapturePreview shot={shot} onToggleShot={() => setShot((s) => !s)} />
            ) : (
              <PairPreview />
            )}
          </PhoneFrame>
        </div>
      </div>
    </>
  );
}
