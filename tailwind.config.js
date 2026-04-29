/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Class strategy — the color mode is driven by the `dark` class on
  // <html>, which AppState's colorMode effect manages. With "media",
  // Tailwind would gate every dark: variant on prefers-color-scheme
  // alone and ignore the class toggle, so the Settings page Light/
  // Dark/Auto picker would have no effect.
  //
  // Auto mode is still honored: the colorMode effect subscribes to
  // matchMedia("(prefers-color-scheme: dark)") and toggles the class
  // accordingly when the user chooses Auto.
  darkMode: "class",
  theme: {
    extend: {
      // Brigades brand-ish accent (placeholder — v0.2 craft pass will
      // replace with the JoeCo neon palette).
      //
      // Note: 950 is REQUIRED. We use `dark:bg-brand-950/30` and
      // similar arbitrary-opacity dark-mode tints in many places. If
      // 950 is missing, those classes silently generate no CSS and
      // the `bg-brand-50` (light) variant from the same expression
      // wins — which is why selected rows + dropzones rendered with
      // a near-white bg in dark mode.
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
          950: "#08203e",
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
