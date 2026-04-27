/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media", // follow macOS system appearance
  theme: {
    extend: {
      // Brigades brand-ish accent (placeholder — adjust later)
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0efff",
          200: "#bbdcff",
          300: "#85c1ff",
          400: "#479fff",
          500: "#1976d2",
          600: "#0e5fb6",
          700: "#0c4a91",
          800: "#0d3f78",
          900: "#0e3463",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
