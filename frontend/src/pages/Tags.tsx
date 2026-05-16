import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { ScreenHeader } from "../ui/clario";
import { DEMO, pick } from "../ui/demo";

const SWATCHES = [
  "oklch(60% 0.13 30)",
  "oklch(64% 0.12 80)",
  "oklch(58% 0.08 155)",
  "oklch(58% 0.1 215)",
  "oklch(58% 0.1 280)",
  "oklch(60% 0.12 0)",
];

const DEFAULT_COLOR = SWATCHES[4]; // violet-ish

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
        setError(t("tags.errorTaken", { defaultValue: "That tag name is already taken." }));
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

  const { rows, isDemo } = pick(tags.data, DEMO.tags);

  return (
    <>
      <ScreenHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {t("tags.manage", { defaultValue: "Tags" })}
            {isDemo && (
              <span className="pill" style={{ fontSize: 10.5, height: 20 }}>
                sample data
              </span>
            )}
          </span>
        }
        sub={t("tags.sub", { defaultValue: "Coloured chips you can attach to entries for filtering and graph nodes." })}
      />

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 28px" }}>
        {/* New tag card */}
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <div className="k-label" style={{ marginBottom: 8 }}>
            {t("tags.new", { defaultValue: "New tag" })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder={t("tags.namePlaceholder", { defaultValue: "e.g. brain-fog" })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: c,
                      border: color === c
                        ? "2px solid var(--ink)"
                        : `1px solid color-mix(in oklch, ${c} 40%, transparent)`,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    title={c}
                    aria-label={c}
                  />
                ))}
              </div>
              <button
                className="btn primary"
                type="submit"
                disabled={!name.trim() || create.isPending}
                style={{ marginLeft: "auto" }}
              >
                {t("tags.create", { defaultValue: "Create tag" })}
              </button>
            </div>
            {error && (
              <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--danger)" }}>
                {error}
              </p>
            )}
          </form>
        </div>

        {/* Tag list card */}
        <div className="card" style={{ overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "16px 18px", color: "var(--ink-3)", fontSize: 13.5 }}>
              {t("tags.empty", { defaultValue: "No tags yet. Create your first tag above." })}
            </div>
          ) : (
            rows.map((tag, i) => (
              <div
                key={tag.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 80px",
                  gap: 14,
                  alignItems: "center",
                  padding: "12px 18px",
                  borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 5,
                    background: tag.color ?? "var(--ink-4)",
                    justifySelf: "center",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                  #{tag.name}
                </span>
                <button
                  className="btn ghost sm"
                  style={{ color: "var(--danger)" }}
                  disabled={isDemo || remove.isPending}
                  onClick={() => {
                    if (!isDemo) remove.mutate(tag.id);
                  }}
                >
                  {t("tags.delete", { defaultValue: "Delete" })}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
