import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { OutboxItem, outbox } from "../lib/mobileOutbox";
import { Icons } from "../ui/clario";

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
    typeof navigator !== "undefined" ? navigator.onLine : true,
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
    const entry = await api.createEntry({
      ts_event: item.ts_event,
      text_md: item.note || "(photo from phone)",
    });
    const file = new File([item.blob], `phone-${item.id}.jpg`, { type: item.mime });
    await api.uploadMedia(entry.id, file, "image");
  }

  async function save() {
    if (!photo) return;
    setSaveState("saving");
    setErrorMsg(null);
    const ts_event = new Date().toISOString();
    try {
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

  /* ── status label ── */
  const statusLabel = ownerLocked
    ? t("mobile.capture.ownerLocked", "Journal locked — drafts will queue")
    : online
      ? t("mobile.capture.online", "Connected")
      : t("mobile.capture.offlineHint", "Offline — drafts queue locally");

  const statusColor = ownerLocked ? "var(--warn)" : online ? "var(--ok)" : "var(--danger)";

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Geist, system-ui, sans-serif",
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 12h4l2-5 4 10 2-5h4" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {t("mobile.capture.heading", "Clario · capture")}
            </div>
            <div style={{ fontSize: 10.5, color: statusColor, marginTop: 1 }}>
              ● {statusLabel}
            </div>
          </div>
        </div>

        {/* Outbox badge */}
        {outboxCount > 0 && (
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              background: "var(--warn-tint)",
              color: "oklch(48% 0.12 75)",
              border: "1px solid color-mix(in oklch, var(--warn) 30%, var(--border))",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {t("mobile.capture.outbox", "{{count}} queued", { count: outboxCount })}
          </span>
        )}
      </header>

      {/* ── Main ── */}
      <main style={{ flex: 1, padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Viewfinder */}
        <div
          style={{
            aspectRatio: "1",
            width: "100%",
            borderRadius: 16,
            border: previewUrl ? "none" : "2px dashed var(--border-2)",
            overflow: "hidden",
            background: previewUrl ? "transparent" : "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="preview"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "0 24px" }}>
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.5 }}>
                <span style={{ display: "inline-flex" }}>{Icons.camera}</span>
              </div>
              <div style={{ fontSize: 13 }}>
                {t("mobile.capture.tapShutter", "Tap the shutter button to take a photo")}
              </div>
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => pickedFile(e.target.files?.[0] ?? null)}
        />

        {/* Shutter row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              cursor: "pointer",
              background: "white",
              border: "3px solid oklch(20% 0.005 250)",
              boxShadow: "0 0 0 3px white, 0 0 0 5px oklch(20% 0.005 250)",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={t("mobile.capture.shutter", "Take photo") ?? "Take photo"}
          />
          {photo && (
            <button
              onClick={save}
              disabled={saveState === "saving"}
              className="btn primary"
              style={{ flex: 1, height: 48, justifyContent: "center", fontSize: 14 }}
            >
              {saveState === "saving"
                ? t("mobile.capture.saving", "Saving…")
                : saveState === "saved"
                  ? t("mobile.capture.saved", "Saved!")
                  : saveState === "queued"
                    ? t("mobile.capture.queued", "Queued — will sync")
                    : t("mobile.capture.save", "Save & sync")}
            </button>
          )}
        </div>

        {/* Note textarea — only when photo is picked */}
        {photo && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("mobile.capture.notePlaceholder", "Optional note — what's happening?") ?? ""}
            rows={3}
            style={{
              width: "100%",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 14,
              color: "var(--ink)",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        )}

        {/* Error message */}
        {saveState === "error" && errorMsg && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--danger-tint)",
              border: "1px solid color-mix(in oklch, var(--danger) 30%, var(--border))",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Privacy reassurance */}
        <div
          style={{
            marginTop: "auto",
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}>
            {Icons.shield}
          </span>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t(
              "mobile.capture.privacyNote",
              "Encrypted on the desktop the moment they arrive. Nothing leaves your home network.",
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
