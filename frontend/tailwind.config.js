/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0c0c10",
        ink: "#e8e8ee",
        accent: "#7c5cff",
      },
    },
  },
  plugins: [],
};
