import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobilePairToken, MobileSession, api } from "../api/client";

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
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-ink/15 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("pair.modalTitle")}</h2>
          <button onClick={onClose} className="text-ink/60 hover:text-ink" aria-label="close">
            ✕
          </button>
        </header>

        <p className="text-xs text-ink/55">{t("pair.intro")}</p>

        {!mint.data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="block text-ink/65 mb-1">{t("pair.ttlLabel")}</span>
                <select
                  value={ttl}
                  onChange={(e) => setTtl(parseInt(e.target.value, 10))}
                  className="w-full bg-bg/40 border border-ink/15 rounded px-2 py-1 text-sm"
                >
                  {TTL_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("pair.ttlMinutes", { count: n })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="block text-ink/65 mb-1">{t("pair.label")}</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-bg/40 border border-ink/15 rounded px-2 py-1 text-sm"
                />
              </label>
            </div>
            <button
              onClick={() => mint.mutate()}
              disabled={mint.isPending}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md text-sm font-medium"
            >
              {mint.isPending ? t("pair.minting") : t("pair.mintButton")}
            </button>
          </div>
        ) : (
          <ActiveQr token={mint.data} onReset={() => mint.reset()} />
        )}

        <SessionsPanel
          sessions={sessions.data?.sessions ?? []}
          onRevoke={(id) => revoke.mutate(id)}
          isRevoking={revoke.isPending}
        />

        <p className="text-[11px] text-ink/40">{t("pair.lockNote")}</p>
      </div>
    </div>
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
    <div className="space-y-3">
      {!token.lan_ok && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          {t("pair.lanWarning")}
        </div>
      )}
      <div className="bg-white rounded-md p-3 flex items-center justify-center">
        <img src={token.qr_data_url} alt="pair-qr" className="w-56 h-56" />
      </div>
      <div className="text-[11px] text-ink/65 space-y-1">
        <div className="flex items-center justify-between">
          <span>{t("pair.expiresIn", { seconds: secondsLeft })}</span>
          <button
            onClick={onReset}
            className="text-ink/50 hover:text-ink underline-offset-2 hover:underline"
          >
            {t("pair.regenerate")}
          </button>
        </div>
        <div>
          <span className="text-ink/45 mr-1">{t("pair.url")}:</span>
          <a
            href={token.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono break-all text-accent hover:underline"
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
  if (sessions.length === 0) {
    return (
      <div className="text-[11px] text-ink/40 pt-2 border-t border-ink/10">
        {t("pair.sessionsEmpty")}
      </div>
    );
  }
  return (
    <div className="pt-2 border-t border-ink/10 space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-ink/45 mb-1">
        {t("pair.sessionsHeading")}
      </div>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between text-[11px]">
          <span className="text-ink/85">
            {s.label}
            <span className="text-ink/45 ml-2">{s.fetches} req</span>
          </span>
          <button
            disabled={isRevoking}
            onClick={() => onRevoke(s.id)}
            className="text-rose-300 hover:text-rose-200 disabled:opacity-50"
          >
            {t("pair.revoke")}
          </button>
        </div>
      ))}
    </div>
  );
}
