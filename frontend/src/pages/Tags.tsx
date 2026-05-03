import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";

const DEFAULT_COLOR = "#7c5cff";

export default function Tags() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createTag({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      setColor(DEFAULT_COLOR);
      setError(null);
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) {
        setError(t("tags.errorTaken"));
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  return (
    <div className="h-full">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">←</Link>
        <h1 className="text-lg font-semibold">{t("tags.manage")}</h1>
      </header>

      <div className="p-6 max-w-xl space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="flex items-end gap-3"
        >
          <label className="flex-1">
            <span className="block text-sm text-ink/70 mb-1">{t("tags.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-canvas border border-ink/20 focus:border-accent outline-none"
            />
          </label>
          <label>
            <span className="block text-sm text-ink/70 mb-1">{t("tags.color")}</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 rounded bg-canvas border border-ink/20"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="bg-accent hover:bg-accent/90 disabled:opacity-50 px-4 py-2 rounded-md font-medium"
          >
            {t("tags.create")}
          </button>
        </form>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <ul className="divide-y divide-ink/10 border border-ink/10 rounded-md">
          {(tags.data ?? []).length === 0 && (
            <li className="px-4 py-3 text-ink/40">{t("tags.empty")}</li>
          )}
          {(tags.data ?? []).map((tag) => (
            <li key={tag.id} className="px-4 py-3 flex items-center gap-3">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: tag.color ?? "#666" }}
              />
              <span className="flex-1">{tag.name}</span>
              <button
                onClick={() => remove.mutate(tag.id)}
                className="text-sm text-red-400 hover:text-red-300"
              >
                {t("tags.delete")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
