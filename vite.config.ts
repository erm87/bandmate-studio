import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned for a Tauri host. Notes:
// - Tauri runs the dev server on port 1420 by convention; we match that.
// - HMR over WebSocket needs a fixed port (not 0/random) so the Tauri
//   webview can connect.
// - We disable Vite's default error overlay's full-screen mode because
//   it covers the chrome we'll need for keyboard shortcut testing.
export default defineConfig(async () => ({
  plugins: [react()],

  // Prevent vite from obscuring rust errors that are written to stderr
  // during `tauri dev`. Tauri reads stderr to know when Vite is ready.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1421,
    },
    watch: {
      // Tell vite to ignore watching `src-tauri` — it's owned by Cargo.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Tauri ships a custom URL protocol (tauri://) and the build output
  // is loaded via that protocol. Use relative asset paths so it works.
  base: "./",

  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: process.env.NODE_ENV !== "production",
  },
}));
