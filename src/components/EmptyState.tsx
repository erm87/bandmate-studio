/**
 * First-run empty state.
 *
 * Shown when no working folder has been chosen. A single big CTA
 * ("Choose Working Folder") opens the native folder picker.
 */

import { useAppState } from "../state/AppState";
import joecoLogoNeon from "../assets/joeco-logo-neon.png";
import joecoLogoWhite from "../assets/joeco-logo-white.png";

export function EmptyState() {
  const { chooseWorkingFolder, state } = useAppState();
  const isLoading = state.status === "loading";
  const errorMessage = state.status === "error" ? state.error : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-6 text-center">
        <picture>
          <img
            src={joecoLogoNeon}
            alt="JoeCo"
            className="mx-auto block h-12 w-auto dark:hidden"
            draggable={false}
          />
          <img
            src={joecoLogoWhite}
            alt="JoeCo"
            className="mx-auto hidden h-12 w-auto dark:block"
            draggable={false}
          />
        </picture>

        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            BandMate Studio
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            A modern companion app for the JoeCo BandMate.
          </p>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Choose a working folder to get started — this is where your
          songs, playlists, and track maps live on your computer before
          they're copied to the BandMate's USB stick.
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              void chooseWorkingFolder();
            }}
            disabled={isLoading}
            className="w-full rounded-lg bg-brand-500 px-4 py-3 font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950"
          >
            {isLoading ? "Loading…" : "Choose Working Folder"}
          </button>

          {errorMessage && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-left text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <p className="pt-2 text-xs text-zinc-400 dark:text-zinc-600">
          Pick an empty folder for a new project, or a folder where
          you've already been organizing BandMate files. We'll create
          the <span className="font-mono">bm_media/</span> structure if
          it's not there.
        </p>
      </div>
    </div>
  );
}
