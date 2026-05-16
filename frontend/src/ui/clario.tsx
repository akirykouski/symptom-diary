/* Clario shared UI kit — ported from the Clario design handoff (ui.jsx /
   screens-1.jsx atoms) into typed TSX, wired to react-router. */
import type { CSSProperties, ReactNode } from "react";
import { NavLink } from "react-router-dom";

/* ─── Icons ──────────────────────────────────────────────────────────── */
export function Icon({
  d,
  size = 16,
  stroke = 1.6,
  fill = "none",
}: {
  d: ReactNode;
  size?: number;
  stroke?: number;
  fill?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

export const Icons = {
  timeline: <Icon d={<><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 3v3M16 3v3M7.5 13h3M7.5 16.5h6M13.5 13h3" /></>} />,
  patterns: <Icon d={<><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></>} />,
  brief: <Icon d={<><path d="M6 2.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5Z" /><path d="M14.5 2.5V7H19" /><path d="M8 11.5h8M8 15h8M8 18h5" /></>} />,
  documents: <Icon d={<path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2h7A2 2 0 0 1 20.5 8.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" />} />,
  labs: <Icon d={<><path d="M9.5 3v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14.5 9V3" /><path d="M8.5 3h7" /><path d="M7.5 14h9" /></>} />,
  meds: <Icon d={<><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-30 12 12)" /><path d="M7.7 6.3l8.6 5" /></>} />,
  graph: <Icon d={<><circle cx="5.5" cy="6.5" r="2" /><circle cx="18.5" cy="6.5" r="2" /><circle cx="12" cy="18" r="2" /><circle cx="12" cy="11.5" r="2" /><path d="M7 7.5l3.5 3M17 7.5l-3.5 3M12 13.5V16" /></>} />,
  tags: <Icon d={<><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8L20.5 11.5a1.4 1.4 0 0 1 0 2L13.5 20.5a1.4 1.4 0 0 1-2 0L3.5 12.5Z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /></>} />,
  mobile: <Icon d={<><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></>} />,
  lock: <Icon d={<><rect x="4.5" y="11" width="15" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>} />,
  plus: <Icon d={<path d="M12 5v14M5 12h14" />} />,
  search: <Icon d={<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>} />,
  chev: <Icon d={<path d="m9 6 6 6-6 6" />} />,
  download: <Icon d={<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M5 20h14" /></>} />,
  share: <Icon d={<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8 11 8-4M8 13l8 4" /></>} />,
  qr: <Icon d={<><rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" /><path d="M14.5 14.5h2v2M20.5 14.5v6M14.5 18.5h2M18 20.5h2.5" /></>} />,
  shield: <Icon d={<><path d="M12 2.5 4.5 5.5v6.4c0 4.4 3.1 8.3 7.5 9.6 4.4-1.3 7.5-5.2 7.5-9.6V5.5L12 2.5Z" /><path d="m9 12.5 2 2 4-4" /></>} />,
  x: <Icon d={<path d="M6 6l12 12M18 6 6 18" />} />,
  retry: <Icon d={<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>} />,
  alert: <Icon d={<><circle cx="12" cy="12" r="9.5" /><path d="M12 7v6M12 16v.5" /></>} />,
  check: <Icon d={<path d="m5 12 5 5 9-11" />} />,
  ext: <Icon d={<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>} />,
  pen: <Icon d={<><path d="m4 20 4-1 11-11-3-3-11 11-1 4Z" /><path d="m14 6 3 3" /></>} />,
  trash: <Icon d={<><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13.5a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7" /></>} />,
  camera: <Icon d={<><path d="M3.5 7.5h3l2-3h7l2 3h3v11a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5v-11Z" /><circle cx="12" cy="13" r="3.5" /></>} />,
  paperclip: <Icon d={<path d="M21 11.5 12 20.5a5.5 5.5 0 0 1-7.8-7.8L13.5 3.5a3.7 3.7 0 0 1 5.2 5.2L9.6 18a2 2 0 0 1-2.8-2.8L15 6.8" />} />,
  microphone: <Icon d={<><rect x="9.5" y="3" width="5" height="11" rx="2.5" /><path d="M6 11v1.5a6 6 0 0 0 12 0V11M12 19v3M9 22h6" /></>} />,
  sparkle: <Icon d={<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />} fill="currentColor" stroke={0} />,
  filter: <Icon d={<path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />} />,
  cpu: <Icon d={<><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /><rect x="9" y="9" width="6" height="6" rx="0.5" /><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" /></>} />,
};

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

/* ─── Atoms ──────────────────────────────────────────────────────────── */
export function Pill({
  children,
  tone = "neutral",
  dot = false,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  style?: CSSProperties;
}) {
  const tones: Record<Tone, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: "var(--surface-2)", fg: "var(--ink-2)", bd: "var(--border)" },
    accent: { bg: "var(--accent-tint)", fg: "var(--accent-strong)", bd: "color-mix(in oklch, var(--accent) 25%, var(--border))" },
    ok: { bg: "var(--ok-tint)", fg: "var(--ok)", bd: "color-mix(in oklch, var(--ok) 25%, var(--border))" },
    warn: { bg: "var(--warn-tint)", fg: "oklch(48% 0.12 75)", bd: "color-mix(in oklch, var(--warn) 30%, var(--border))" },
    danger: { bg: "var(--danger-tint)", fg: "var(--danger)", bd: "color-mix(in oklch, var(--danger) 30%, var(--border))" },
    info: { bg: "var(--info-tint)", fg: "var(--info)", bd: "color-mix(in oklch, var(--info) 25%, var(--border))" },
  };
  const tt = tones[tone] ?? tones.neutral;
  return (
    <span className="pill" style={{ background: tt.bg, color: tt.fg, borderColor: tt.bd, ...style }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", opacity: 0.8 }} />}
      {children}
    </span>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--border)",
        background: active ? "var(--accent-tint)" : "var(--surface)",
        color: active ? "var(--accent-strong)" : "var(--ink-2)",
        borderRadius: 8,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function Avatar({ initials = "ML", size = 30 }: { initials?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "linear-gradient(135deg, var(--accent) 0%, oklch(64% 0.09 180) 100%)",
        color: "white",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {initials}
    </div>
  );
}

export function SeverityBar({ value, max = 10 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value <= 3 ? "var(--ok)" : value <= 6 ? "var(--warn)" : "var(--danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 999, background: "var(--surface-3)" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", minWidth: 24, textAlign: "right" }}>
        {value}/{max}
      </span>
    </div>
  );
}

export function MoodDots({ value }: { value: number }) {
  return (
    <div style={{ display: "inline-flex", gap: 3 }}>
      {[-2, -1, 0, 1, 2].map((i) => {
        const active = i === value;
        const color = i <= -1 ? "var(--danger)" : i === 0 ? "var(--ink-4)" : "var(--ok)";
        return (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: active ? color : "transparent",
              border: active ? "none" : "1px solid var(--border-2)",
            }}
          />
        );
      })}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "Geist Mono",
        fontSize: 10.5,
        padding: "2px 5px",
        borderRadius: 5,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--ink-3)",
        boxShadow: "0 1px 0 rgba(20,28,40,0.04)",
      }}
    >
      {children}
    </kbd>
  );
}

/* ─── Form bits ──────────────────────────────────────────────────────── */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Inline({ tone, children }: { tone?: "danger" | "info"; children: ReactNode }) {
  const map = {
    danger: { bg: "var(--danger-tint)", fg: "var(--danger)" },
    info: { bg: "var(--info-tint)", fg: "var(--info)" },
  };
  const tt = map[tone ?? "info"];
  return (
    <div
      style={{
        padding: "8px 12px",
        background: tt.bg,
        color: tt.fg,
        borderRadius: 8,
        fontSize: 12.5,
        lineHeight: 1.5,
        border: `1px solid color-mix(in oklch, ${tt.fg} 25%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

/* ─── Auth shell + brand ─────────────────────────────────────────────── */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, var(--bg) 0%, var(--surface-2) 100%)",
        padding: 40,
      }}
    >
      <div className="card" style={{ width: 440, padding: 36, boxShadow: "var(--shadow-2)" }}>
        {children}
      </div>
    </div>
  );
}

export function BrandLockup({ sub = "Symptom diary · local-first" }: { sub?: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          boxShadow: "inset 0 -3px 0 rgba(0,0,0,.08), 0 4px 12px color-mix(in oklch, var(--accent) 30%, transparent)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 12h4l2-5 4 10 2-5h4" />
        </svg>
      </div>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>Clario</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{sub}</div>
      </div>
    </div>
  );
}

/* ─── Screen header + tabs ───────────────────────────────────────────── */
export function ScreenHeader({
  title,
  sub,
  actions,
  tabs,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header
      style={{
        padding: "18px 28px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: "var(--ink)" }}>{title}</h1>
        {sub && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{sub}</p>}
        {tabs && <div style={{ marginTop: 12, display: "flex", gap: 4, flexWrap: "wrap" }}>{tabs}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
    </header>
  );
}

export function Tab({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: "0 12px",
        background: active ? "var(--surface)" : "transparent",
        border: active ? "1px solid var(--border)" : "1px solid transparent",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
      {count !== undefined && (
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            padding: "1px 6px",
            borderRadius: 999,
            background: active ? "var(--accent-tint)" : "var(--surface-2)",
            color: active ? "var(--accent-strong)" : "var(--ink-3)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ─── Modal ──────────────────────────────────────────────────────────── */
export function Modal({
  onClose,
  children,
  width = 640,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 28, 40, 0.28)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-in"
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "88%",
          overflow: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow-3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 10 }}>
        <span className="k-label">{title}</span>
        {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

/* ─── Sidebar ────────────────────────────────────────────────────────── */
export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Timeline", icon: Icons.timeline, end: true },
  { to: "/hypotheses", label: "Patterns", icon: Icons.patterns, badge: "AI" },
  { to: "/insights", label: "Clinician brief", icon: Icons.brief },
  { to: "/documents", label: "Documents", icon: Icons.documents },
  { to: "/labs", label: "Labs", icon: Icons.labs },
  { to: "/medications", label: "Medications", icon: Icons.meds },
  { to: "/graph", label: "Graph", icon: Icons.graph },
  { to: "/tags", label: "Tags", icon: Icons.tags },
];
const NAV_FOOT: NavItem[] = [
  { to: "/llm", label: "AI models", icon: Icons.cpu },
  { to: "/mobile", label: "Mobile companion", icon: Icons.mobile },
];

function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `navrow ${isActive ? "active" : ""}`}
    >
      <span className="ic" aria-hidden="true" style={{ display: "inline-flex" }}>
        {item.icon}
      </span>
      <span>{item.label}</span>
      {item.badge && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: 0.6,
            padding: "2px 6px",
            borderRadius: 999,
            background: "var(--accent-tint)",
            color: "var(--accent-strong)",
          }}
        >
          {item.badge}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar({
  user,
  queueProcessing = 0,
  llmModel,
  ollamaUp,
  onLock,
}: {
  user: { name: string; initials: string };
  queueProcessing?: number;
  llmModel?: string;
  ollamaUp?: boolean;
  onLock: () => void;
}) {
  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "18px 16px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,.08)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 12h4l2-5 4 10 2-5h4" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: -0.2 }}>Clario</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>Local · Encrypted · Yours</div>
        </div>
      </div>

      <nav aria-label="Primary" style={{ padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV.map((n) => (
          <NavRow key={n.to} item={n} />
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{ padding: "10px 12px 4px" }}>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: queueProcessing > 0 ? "var(--accent-tint)" : "var(--surface-2)",
            border:
              "1px solid " +
              (queueProcessing > 0
                ? "color-mix(in oklch, var(--accent) 22%, var(--border))"
                : "var(--border)"),
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: queueProcessing > 0 ? "var(--accent)" : ollamaUp ? "var(--ok)" : "var(--ink-4)",
                boxShadow:
                  queueProcessing > 0
                    ? "0 0 0 3px color-mix(in oklch, var(--accent) 20%, transparent)"
                    : "none",
              }}
            />
            <span style={{ fontWeight: 500, color: "var(--ink)" }}>
              {queueProcessing > 0
                ? `${queueProcessing} processing`
                : ollamaUp
                  ? "AI extractor idle"
                  : "Ollama offline"}
            </span>
          </div>
          <div className="mono" style={{ marginTop: 4, fontSize: 10.5 }}>
            {ollamaUp ? `Ollama · ${llmModel ?? "gemma3:4b"}` : "Set up in AI models →"}
          </div>
        </div>
      </div>

      <nav aria-label="Secondary" style={{ padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV_FOOT.map((n) => (
          <NavRow key={n.to} item={n} />
        ))}
      </nav>

      <div
        style={{
          padding: "10px 12px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Avatar initials={user.initials} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)", whiteSpace: "nowrap" }}>
            {user.name}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--ok)" }} />
            Unlocked · idle lock 15m
          </div>
        </div>
        <button
          className="btn ghost sm"
          onClick={onLock}
          title="Lock journal"
          aria-label="Lock journal"
          style={{ padding: "0 8px" }}
        >
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            {Icons.lock}
          </span>
        </button>
      </div>
    </aside>
  );
}
