/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Remapped onto the Clario light palette so any remaining legacy
        // Tailwind utility classes degrade gracefully onto the new theme.
        canvas: "#ffffff",
        ink: "#1d2433",
        accent: "#2b7c93",
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
