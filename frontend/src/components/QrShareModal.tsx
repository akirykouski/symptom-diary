import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, QrSession } from "../api/client";

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
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-ink/15 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("qr.modalTitle")}</h2>
          <button onClick={onClose} className="text-ink/60 hover:text-ink" aria-label="close">
            ✕
          </button>
        </header>

        <p className="text-xs text-ink/55">{t("qr.intro", { minutes: ttl })}</p>

        {!active ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="block text-ink/65 mb-1">{t("qr.ttlLabel")}</span>
              <select
                value={ttl}
                onChange={(e) => setTtl(parseInt(e.target.value, 10))}
                className="bg-bg/40 border border-ink/15 rounded px-2 py-1 text-sm"
              >
                {TTL_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {t("qr.ttlMinutes", { count: n })}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md text-sm font-medium"
            >
              {create.isPending ? t("qr.creating") : t("qr.createBtn")}
            </button>
          </div>
        ) : (
          <ActiveSession
            session={active}
            onRevoke={() => revoke.mutate(active.token)}
            isRevoking={revoke.isPending}
          />
        )}

        {sessions.data && sessions.data.sessions.length > 0 && !active && (
          <ul className="text-[11px] text-ink/55 space-y-1 pt-2 border-t border-ink/10">
            {sessions.data.sessions.map((s) => (
              <li key={s.token} className="flex items-center justify-between">
                <span className="font-mono truncate mr-2">…{s.token.slice(-8)}</span>
                <span>{t("qr.fetches", { count: s.fetches })}</span>
                <button
                  onClick={() => revoke.mutate(s.token)}
                  className="text-rose-300 hover:text-rose-200 ml-2"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-ink/40">{t("qr.noteLocked")}</p>
      </div>
    </div>
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

  return (
    <div className="space-y-3">
      {!session.lan_ok && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          {t("qr.lanWarning")}
        </div>
      )}
      <div className="bg-white rounded-md p-3 flex items-center justify-center">
        {/* qr_data_url is `data:image/svg+xml;base64,…` */}
        <img src={session.qr_data_url} alt="QR" className="w-56 h-56" />
      </div>
      <div className="text-[11px] text-ink/65 space-y-1">
        <div className="flex items-center justify-between">
          <span>{t("qr.expiresIn", { seconds: secondsLeft })}</span>
          <span>{t("qr.fetches", { count: session.fetches })}</span>
        </div>
        <div>
          <span className="text-ink/45 mr-1">{t("qr.url")}:</span>
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono break-all text-accent hover:underline"
          >
            {session.url}
          </a>
        </div>
      </div>
      <button
        onClick={onRevoke}
        disabled={isRevoking}
        className="w-full px-4 py-2 rounded-md border border-rose-500/40 text-rose-200 hover:bg-rose-500/10 text-sm"
      >
        {isRevoking ? t("qr.revoking") : t("qr.revoke")}
      </button>
    </div>
  );
}
