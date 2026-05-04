import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Media, MediaKind } from "../api/client";
import { api } from "../api/client";

export default function MediaPanel({ entryId }: { entryId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const photoInput = useRef<HTMLInputElement | null>(null);
  const audioInput = useRef<HTMLInputElement | null>(null);
  const docInput = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["entry", entryId, "media"],
    queryFn: () => api.listEntryMedia(entryId),
    refetchInterval: (q) => {
      const data = q.state.data as Media[] | undefined;
      if (!data) return 4_000;
      return data.some((m) => m.status === "pending" || m.status === "running")
        ? 2_500
        : false;
    },
  });

  const upload = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: MediaKind }) =>
      api.uploadMedia(entryId, file, kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entry", entryId, "media"] });
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "upload failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMedia(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["entry", entryId, "media"] }),
  });

  const reprocess = useMutation({
    mutationFn: (id: string) => api.reprocessMedia(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["entry", entryId, "media"] }),
  });

  function pickFile(ref: React.RefObject<HTMLInputElement | null>, kind: MediaKind) {
    const f = ref.current?.files?.[0];
    if (!f) return;
    upload.mutate({ file: f, kind });
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="border border-ink/10 rounded-md p-3 bg-ink/5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-ink/40">{t("media.heading")}</span>
        <div className="flex gap-2">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={() => pickFile(photoInput, "image")}
          />
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-ink/10"
            disabled={upload.isPending}
          >
            {t("media.attachPhoto")}
          </button>
          <input
            ref={audioInput}
            type="file"
            accept="audio/*,video/webm,video/ogg"
            className="hidden"
            onChange={() => pickFile(audioInput, "audio")}
          />
          <button
            type="button"
            onClick={() => audioInput.current?.click()}
            className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-ink/10"
            disabled={upload.isPending}
          >
            {t("media.attachAudio")}
          </button>
          <input
            ref={docInput}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={() => pickFile(docInput, "document")}
          />
          <button
            type="button"
            onClick={() => docInput.current?.click()}
            className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-ink/10"
            disabled={upload.isPending}
          >
            {t("media.attachDocument")}
          </button>
        </div>
      </div>

      {upload.isPending && (
        <div className="text-xs text-ink/50">{t("media.uploading")}</div>
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}

      {list.data && list.data.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {list.data.map((m) => (
            <MediaCard
              key={m.id}
              media={m}
              onDelete={() => remove.mutate(m.id)}
              onReprocess={() => reprocess.mutate(m.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-xs text-ink/40">{t("media.empty")}</div>
      )}
    </div>
  );
}

function MediaCard({
  media,
  onDelete,
  onReprocess,
}: {
  media: Media;
  onDelete: () => void;
  onReprocess: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border border-ink/10 rounded p-2 bg-canvas/40 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs uppercase text-ink/40">{media.kind}</span>
        <StatusBadge status={media.status} />
      </div>

      {media.kind === "image" || media.kind === "document" ? (
        <a
          href={api.mediaUrl(media.id)}
          target="_blank"
          rel="noreferrer"
          className="block"
        >
          <img
            src={api.mediaThumbUrl(media.id)}
            alt={media.description ?? media.kind}
            className="w-full h-32 object-cover rounded"
            loading="lazy"
          />
        </a>
      ) : (
        <audio
          controls
          src={api.mediaUrl(media.id)}
          className="w-full"
          preload="metadata"
        />
      )}

      {media.description && (
        <div className="text-[11px] text-ink/70 line-clamp-3">
          {media.description}
        </div>
      )}
      {media.transcript && (
        <div className="text-[11px] italic text-ink/65 line-clamp-3">
          “{media.transcript}”
        </div>
      )}
      {media.last_error && (
        <div className="text-[11px] text-red-400">{media.last_error}</div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onReprocess}
          className="text-[11px] px-1.5 py-0.5 rounded border border-ink/15 hover:bg-ink/10"
        >
          {t("media.reprocess")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] px-1.5 py-0.5 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
        >
          {t("media.delete")}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Media["status"] }) {
  const palette: Record<Media["status"], string> = {
    pending: "bg-ink/10 text-ink/60",
    running: "bg-amber-500/15 text-amber-300",
    done: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-red-500/15 text-red-300",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${palette[status]}`}>
      {status}
    </span>
  );
}
