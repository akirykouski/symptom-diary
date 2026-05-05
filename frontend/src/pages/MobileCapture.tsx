import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { OutboxItem, outbox } from "../lib/mobileOutbox";

type SaveState = "idle" | "saving" | "queued" | "saved" | "error";

export default function MobileCapture() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Keep the outbox badge in sync.
  useEffect(() => {
    let alive = true;
    const refresh = () => outbox.count().then((n) => alive && setOutboxCount(n));
    refresh();
    const off = outbox.subscribe(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Online/offline transitions kick a flush.
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushOutbox();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Periodic flush attempts while the page is open.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (navigator.onLine) void flushOutbox();
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Verify pairing on mount; bounce to /m/pair if not paired.
  const whoami = useQuery({
    queryKey: ["mobile", "whoami"],
    queryFn: api.mobileWhoami,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!whoami.data) return;
    if (!whoami.data.paired) {
      navigate("/m/pair", { replace: true });
    }
  }, [whoami.data, navigate]);

  const ownerLocked = whoami.data && whoami.data.paired && !whoami.data.owner_unlocked;

  function pickedFile(f: File | null) {
    setPhoto(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function flushOutbox() {
    try {
      await outbox.flush(uploadOutboxItem);
    } catch {
      /* ignore — next tick will retry */
    }
  }

  async function uploadOutboxItem(item: OutboxItem): Promise<void> {
    // Create the entry first.
    const entry = await api.createEntry({
      ts_event: item.ts_event,
      text_md: item.note || "(photo from phone)",
    });
    // Then attach the photo.
    const file = new File([item.blob], `phone-${item.id}.jpg`, { type: item.mime });
    await api.uploadMedia(entry.id, file, "image");
  }

  async function save() {
    if (!photo) return;
    setSaveState("saving");
    setErrorMsg(null);
    const ts_event = new Date().toISOString();
    try {
      // Try direct upload first.
      const entry = await api.createEntry({
        ts_event,
        text_md: note || "(photo from phone)",
      });
      await api.uploadMedia(entry.id, photo, "image");
      setSaveState("saved");
      setTimeout(() => {
        pickedFile(null);
        setNote("");
        setSaveState("idle");
      }, 1500);
    } catch (e: unknown) {
      const status = e instanceof ApiError ? e.status : 0;
      // 401 → owner locked OR cookie gone. Fall back to outbox so the photo
      // isn't lost; we'll retry next time the journal is unlocked.
      if (status === 401 || status === 0 || !navigator.onLine) {
        await outbox.enqueue({
          blob: photo,
          mime: photo.type || "image/jpeg",
          note,
          ts_event,
        });
        setSaveState("queued");
        setTimeout(() => {
          pickedFile(null);
          setNote("");
          setSaveState("idle");
        }, 1500);
      } else {
        setSaveState("error");
        setErrorMsg(t("mobile.capture.errorGeneric") ?? "");
      }
    }
  }

  return (
    <div className="min-h-full bg-canvas text-ink flex flex-col">
      <header className="sticky top-0 z-10 bg-canvas/90 backdrop-blur border-b border-ink/10 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{t("mobile.capture.heading")}</div>
          <div className="text-[11px] text-ink/50">
            {ownerLocked
              ? t("mobile.capture.ownerLocked")
              : online
              ? t("mobile.capture.online")
              : t("mobile.capture.offlineHint")}
          </div>
        </div>
        <div className="text-[11px] text-ink/55">
          {outboxCount > 0 && (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-200">
              {t("mobile.capture.outbox", { count: outboxCount })}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 space-y-4">
        <div className="aspect-square w-full rounded-xl border-2 border-dashed border-ink/20 overflow-hidden bg-ink/5 flex items-center justify-center">
          {previewUrl ? (
            <img src={previewUrl} alt="preview" className="w-full h-full object-cover" />
          ) : (
            <div className="text-ink/40 text-sm text-center px-6">
              {t("mobile.capture.tapShutter")}
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pickedFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full bg-accent hover:bg-accent/90 text-white py-4 rounded-xl text-lg font-medium"
        >
          📷 {t("mobile.capture.shutter")}
        </button>

        {photo && (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("mobile.capture.notePlaceholder") ?? ""}
              rows={3}
              className="w-full bg-ink/5 border border-ink/15 rounded-md p-3 text-sm resize-none focus:outline-none focus:border-accent/60"
            />
            <button
              onClick={save}
              disabled={saveState === "saving"}
              className="w-full bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-50 text-white py-3 rounded-xl text-base font-medium"
            >
              {saveState === "saving"
                ? t("mobile.capture.saving")
                : saveState === "saved"
                ? "✓ " + t("mobile.capture.saved")
                : saveState === "queued"
                ? "📥 " + t("mobile.capture.queued")
                : t("mobile.capture.save")}
            </button>
            {saveState === "error" && errorMsg && (
              <div className="text-rose-300 text-sm">{errorMsg}</div>
            )}
          </>
        )}

        <p className="text-[11px] text-ink/40 text-center pt-2">
          {t("mobile.capture.privacyNote")}
        </p>
      </main>
    </div>
  );
}
