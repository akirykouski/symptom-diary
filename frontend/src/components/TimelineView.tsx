import { useEffect, useRef } from "react";
import { DataSet } from "vis-timeline/standalone";
import { Timeline } from "vis-timeline/standalone";
import type { Entry } from "../api/client";

interface Props {
  entries: Entry[];
  onSelect: (id: string) => void;
}

export default function TimelineView({ entries, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<{ id: string; content: string; start: Date; title?: string }>>(
    new DataSet(),
  );
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const tl = new Timeline(containerRef.current, itemsRef.current, {
      stack: true,
      orientation: "top",
      zoomMin: 1000 * 60 * 30,
      zoomMax: 1000 * 60 * 60 * 24 * 365 * 5,
      tooltip: { followMouse: true, overflowMethod: "cap" },
      height: "100%",
    });
    tl.on("select", (props: { items: (string | number)[] }) => {
      const id = props.items[0];
      if (typeof id === "string") onSelectRef.current(id);
    });
    timelineRef.current = tl;
    return () => {
      tl.destroy();
      timelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const items = entries.map((e) => ({
      id: e.id,
      content: shorten(e.text_md),
      start: new Date(e.ts_event),
      title: buildTitle(e),
    }));
    itemsRef.current.clear();
    itemsRef.current.add(items);
    if (items.length > 0 && timelineRef.current) {
      timelineRef.current.fit({ animation: false });
    }
  }, [entries]);

  return <div ref={containerRef} className="h-full" />;
}

function shorten(text: string): string {
  const stripped = text.replace(/[#*`_>\-]/g, "").trim();
  return stripped.length > 60 ? stripped.slice(0, 60) + "…" : stripped;
}

function buildTitle(e: Entry): string {
  const parts: string[] = [new Date(e.ts_event).toLocaleString()];
  if (e.severity != null) parts.push(`severity ${e.severity}`);
  if (e.mood != null) parts.push(`mood ${e.mood}`);
  if (e.tags.length > 0) parts.push(e.tags.map((t) => `#${t.name}`).join(" "));
  return parts.join(" · ");
}
