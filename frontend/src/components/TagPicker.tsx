import type { Tag } from "../api/client";

export default function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  if (tags.length === 0) {
    return <p className="text-ink/40 text-sm">No tags yet — create them on the Tags page.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            className={`px-2.5 py-1 text-sm rounded-full border transition ${
              on
                ? "bg-accent/20 border-accent text-ink"
                : "border-ink/20 text-ink/70 hover:border-ink/40"
            }`}
            style={tag.color && on ? { backgroundColor: `${tag.color}33`, borderColor: tag.color } : undefined}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
