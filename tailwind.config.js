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
      // BandMate Studio palette — v0.2 craft pass (JoeCo-aligned).
      //
      // Two scales:
      //   `brand`  — rich saturated blue. The PRIMARY action / state
      //              color. Used for primary buttons, selected rows,
      //              the dirty indicator, "Saved" / "Current" badges,
      //              etc. Anchored at 500 = #0051E8 — Eric's pick;
      //              richer + more saturated than the previous
      //              Material-Design #1976d2.
      //
      //   `accent` — electric cyan, matched to JoeCo's neon brand
      //              logo. Used SPARINGLY for ATTENTION moments:
      //              focus rings, hover glows, hand-raise highlights.
      //              Not a wash — the cyan only pops because the rest
      //              of the chrome stays on muted zinc neutrals.
      //
      // Both scales include a 950 shade — REQUIRED. Many places use
      // arbitrary-opacity tints like `dark:bg-brand-950/30`. If 950
      // is missing, those classes silently generate no CSS and the
      // light variant wins (which is the bug that previously rendered
      // selected rows near-white in dark mode).
      colors: {
        brand: {
          50: "#ebf1fe",
          100: "#d7e3fe",
          200: "#b0c7fd",
          300: "#82a4fb",
          400: "#4d7af8",
          500: "#0051e8",
          600: "#0041c0",
          700: "#003396",
          800: "#002770",
          900: "#001c50",
          950: "#000f2e",
        },
        accent: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
          950: "#083344",
        },
      },
      // Custom font sizes below Tailwind's `text-xs` (12px). The dense
      // editor UI uses several distinct caption-class sizes; these
      // tokens replace 60+ ad-hoc `text-[9px]` / `text-[10px]` /
      // `text-[11px]` magic numbers across the codebase. Naming follows
      // Tailwind's `2xs / 3xs` extension convention so the ramp reads
      // cleanly: 3xs → 2xs → xs → sm → base.
      //
      //   text-3xs  9px / 12 line-height — tiny uppercase pills (CURRENT, MIDI)
      //   text-2xs  10px / 14            — eyebrow labels (SAMPLE RATE, etc.)
      //   text-meta 11px / 15            — caption rows (durations, file counts)
      fontSize: {
        "3xs": ["9px", "12px"],
        "2xs": ["10px", "14px"],
        meta: ["11px", "15px"],
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
