/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Map all colors onto the Clario token system (see index.css :root).
      // Legacy names (canvas/ink/accent) are remapped so existing utility
      // classes pick up the light clinical theme automatically.
      colors: {
        canvas: "var(--bg)",
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: "var(--border)",
        "border-2": "var(--border-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        "ink-4": "var(--ink-4)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-tint": "var(--accent-tint)",
        sage: "var(--sage)",
        "sage-tint": "var(--sage-tint)",
        coral: "var(--coral)",
        "coral-tint": "var(--coral-tint)",
        amber: "var(--amber)",
        "amber-tint": "var(--amber-tint)",
        violet: "var(--violet)",
        "violet-tint": "var(--violet-tint)",
        ok: "var(--ok)",
        "ok-tint": "var(--ok-tint)",
        warn: "var(--warn)",
        "warn-tint": "var(--warn-tint)",
        danger: "var(--danger)",
        "danger-tint": "var(--danger-tint)",
        info: "var(--info)",
        "info-tint": "var(--info-tint)",
      },
      fontFamily: {
        sans: ["Geist", "-apple-system", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--r-sm)",
        DEFAULT: "var(--r)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
      },
      boxShadow: {
        "c-1": "var(--shadow-1)",
        "c-2": "var(--shadow-2)",
        "c-3": "var(--shadow-3)",
      },
    },
  },
  plugins: [],
};
