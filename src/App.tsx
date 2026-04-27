/**
 * BandMate Studio — placeholder shell for Phase 0 scaffold verification.
 *
 * This screen exists to confirm the Tauri+Vite+React+Tailwind toolchain
 * runs end-to-end. We're intentionally NOT writing real UI here yet —
 * Phase 1 (file-format codec library) comes first, then Phase 2 (working
 * folder + project state) lays down the actual app shell.
 *
 * Once you've seen this render in `pnpm tauri dev`, this file gets
 * replaced.
 */
export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          BandMate Studio
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Phase 0 scaffold — toolchain check. If you can read this in a
          native macOS window, the build is wired up correctly.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Next up: <span className="font-mono">SPEC.md</span> Phase 1 — file-format
          codec library.
        </p>
        <div className="pt-4">
          <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-100">
            v0.1.0-pre
          </span>
        </div>
      </div>
    </main>
  );
}
