/**
 * Settings page (modal overlay).
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │ Settings                                  (×) │
 *   ├──────────────┬────────────────────────────────┤
 *   │ Appearance   │  ▢ Light  ▢ Auto  ▢ Dark      │
 *   │ Defaults     │                                │
 *   │              │                                │
 *   └──────────────┴────────────────────────────────┘
 *
 * Each section is rendered in its own component below. Add a new
 * section by appending to SECTIONS and writing a `<SectionXxx />`
 * component — the left-rail nav and right-pane router pick it up.
 *
 * Trigger: gear icon in WorkingFolderBar.
 *
 * Persistence: every control writes through `setUserPrefs` from
 * AppState, which persists to localStorage and applies side effects
 * (e.g., the colorMode effect in AppStateProvider toggles the
 * document root's `dark` class).
 *
 * Close: ESC, click on the backdrop, or the × button.
 */

import { useEffect, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { cleanMidiFile, listAudioFiles } from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import type { ColorMode, DefaultSampleRate } from "../state/persistence";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type SectionId = "appearance" | "defaults" | "midi" | "export";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "defaults", label: "Defaults" },
  { id: "midi", label: "MIDI" },
  { id: "export", label: "Export" },
];

export function SettingsDialog({ isOpen, onClose }: Props) {
  const [active, setActive] = useState<SectionId>("appearance");

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-6 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[600px] max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        {/* Left rail — section list */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <h2
            id="settings-title"
            className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500"
          >
            Settings
          </h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-left text-sm transition",
                active === s.id
                  ? "bg-brand-500 font-semibold text-white"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Right pane — section content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {SECTIONS.find((s) => s.id === active)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {active === "appearance" && <AppearanceSection />}
            {active === "defaults" && <DefaultsSection />}
            {active === "midi" && <MidiSection />}
            {active === "export" && <ExportSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance section
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const { state, setUserPrefs } = useAppState();
  const current = state.userPrefs.colorMode;
  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Color mode
      </p>
      <div className="grid grid-cols-3 gap-3">
        <ColorModeCard
          mode="light"
          label="Light"
          isActive={current === "light"}
          onSelect={() => setUserPrefs({ colorMode: "light" })}
        />
        <ColorModeCard
          mode="auto"
          label="Auto"
          isActive={current === "auto"}
          onSelect={() => setUserPrefs({ colorMode: "auto" })}
        />
        <ColorModeCard
          mode="dark"
          label="Dark"
          isActive={current === "dark"}
          onSelect={() => setUserPrefs({ colorMode: "dark" })}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Auto follows your operating system's appearance setting and updates
        live when you change it.
      </p>
    </section>
  );
}

/**
 * One of the three Light/Auto/Dark cards. Each card paints a small
 * preview of the app chrome in the corresponding theme. The Auto card
 * splits down the middle — light on the left, dark on the right —
 * to communicate the "follows system" semantic at a glance.
 */
function ColorModeCard({
  mode,
  label,
  isActive,
  onSelect,
}: {
  mode: ColorMode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg p-2 transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg ring-2 transition",
          isActive
            ? "ring-brand-500"
            : "ring-zinc-200 hover:ring-zinc-300 dark:ring-zinc-800 dark:hover:ring-zinc-700",
        )}
      >
        <ColorModePreview mode={mode} />
      </div>
      <span
        className={cn(
          "text-sm",
          isActive
            ? "font-semibold text-zinc-900 dark:text-zinc-100"
            : "text-zinc-600 dark:text-zinc-400",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Stylized mini-mockup of the app: header strip, sidebar lines, an
 * accent button. Two themed palettes (light / dark); Auto renders the
 * light layout on the left half and dark layout on the right half.
 */
function ColorModePreview({ mode }: { mode: ColorMode }) {
  if (mode === "auto") {
    return (
      <div className="flex aspect-[5/3] w-full">
        <div className="w-1/2 overflow-hidden">
          <PreviewArtwork variant="light" half="left" />
        </div>
        <div className="w-1/2 overflow-hidden">
          <PreviewArtwork variant="dark" half="right" />
        </div>
      </div>
    );
  }
  return (
    <div className="aspect-[5/3] w-full">
      <PreviewArtwork variant={mode === "light" ? "light" : "dark"} />
    </div>
  );
}

function PreviewArtwork({
  variant,
  half,
}: {
  variant: "light" | "dark";
  half?: "left" | "right";
}) {
  const palette =
    variant === "light"
      ? {
          bg: "#f4f4f5",       // zinc-100
          panel: "#ffffff",
          line: "#e4e4e7",     // zinc-200
          dim: "#a1a1aa",      // zinc-400
        }
      : {
          bg: "#18181b",       // zinc-900
          panel: "#09090b",    // zinc-950
          line: "#3f3f46",     // zinc-700
          dim: "#52525b",      // zinc-600
        };
  // For the Auto card we render only one half — but to keep the
  // proportions matching the full-size cards we double the visual
  // width via the parent's overflow:hidden + a 200%-wide internal
  // canvas and shifted positioning.
  const widthClass = half ? "w-[200%]" : "w-full";
  const shift = half === "right" ? "-translate-x-1/2" : "";
  return (
    <div
      className={cn("flex h-full flex-col p-2", widthClass, shift)}
      style={{ background: palette.bg }}
    >
      {/* Mini header */}
      <div
        className="mb-1.5 flex h-3 items-center gap-1 rounded-sm px-1"
        style={{ background: palette.panel, border: `1px solid ${palette.line}` }}
      >
        <span
          className="h-1.5 w-4 rounded-sm"
          style={{ background: palette.dim }}
        />
      </div>
      {/* Body row */}
      <div className="flex flex-1 gap-1.5">
        {/* Sidebar */}
        <div
          className="flex w-10 flex-col gap-1 rounded-sm p-1"
          style={{
            background: palette.panel,
            border: `1px solid ${palette.line}`,
          }}
        >
          <span
            className="h-1 w-full rounded-sm"
            style={{ background: palette.dim }}
          />
          <span
            className="h-1 w-3/4 rounded-sm"
            style={{ background: palette.dim }}
          />
          <span
            className="h-1 w-2/3 rounded-sm"
            style={{ background: palette.dim }}
          />
        </div>
        {/* Main pane */}
        <div
          className="flex flex-1 flex-col items-end justify-end gap-1 rounded-sm p-1"
          style={{
            background: palette.panel,
            border: `1px solid ${palette.line}`,
          }}
        >
          <span className="h-2 w-3 rounded-sm bg-brand-500" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defaults section
// ---------------------------------------------------------------------------

function DefaultsSection() {
  const { state, setUserPrefs } = useAppState();
  const currentRate = state.userPrefs.defaultSampleRate;
  const currentTrackMap = state.userPrefs.defaultTrackMapJcm;
  const trackMaps = state.scan.trackMaps;
  // If the saved default doesn't exist in the current working folder,
  // surface that gently so the user understands the fallback. Doesn't
  // auto-rewrite the pref — they might be switching working folders
  // back and forth and we don't want to forget their preference.
  const currentTrackMapMissing =
    trackMaps.length > 0 &&
    !trackMaps.some((tm) => tm.filename === currentTrackMap);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Default sample rate
        </p>
        <div className="flex gap-2">
          <SampleRateChip
            rate={44100}
            label="44.1 kHz"
            isActive={currentRate === 44100}
            onSelect={() => setUserPrefs({ defaultSampleRate: 44100 })}
          />
          <SampleRateChip
            rate={48000}
            label="48 kHz"
            isActive={currentRate === 48000}
            onSelect={() => setUserPrefs({ defaultSampleRate: 48000 })}
          />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Pre-fills the sample-rate selector when you create a new song or
          playlist. You can still override it for any individual file.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Default track map
        </p>
        <select
          value={currentTrackMap}
          onChange={(e) =>
            setUserPrefs({ defaultTrackMapJcm: e.target.value })
          }
          disabled={trackMaps.length === 0}
          className="user-text w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
        >
          {trackMaps.length === 0 && (
            <option value="">(no track maps in working folder)</option>
          )}
          {/* If the saved default isn't in the scan, render it as a
              synthesized option so the dropdown reflects the user's
              stored preference rather than silently swapping to the
              first available. */}
          {currentTrackMapMissing && (
            <option value={currentTrackMap}>
              {currentTrackMap} (not in this folder)
            </option>
          )}
          {trackMaps.map((tm) => (
            <option key={tm.path} value={tm.filename}>
              {tm.filename}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Pre-selects this track map when you create a new song or playlist.
          {currentTrackMapMissing && (
            <>
              {" "}
              The selected file isn't in the current working folder — new
              songs and playlists will fall back to{" "}
              <span className="font-mono">default_tm.jcm</span> for now.
            </>
          )}
        </p>
      </div>

      <DefaultExportDestField />
    </section>
  );
}

/**
 * Default USB export destination — sticky path that pre-selects in
 * ExportToUsbDialog when there's no session memory. Useful for bands
 * that ship to the same physical stick week after week.
 */
function DefaultExportDestField() {
  const { state, setUserPrefs } = useAppState();
  const current = state.userPrefs.defaultExportDestPath;

  const handleChoose = async () => {
    const result = await openDialog({ directory: true, multiple: false });
    if (typeof result === "string") {
      setUserPrefs({ defaultExportDestPath: result });
    }
  };
  const handleClear = () => {
    setUserPrefs({ defaultExportDestPath: "" });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Default USB export destination
      </p>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "user-text min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs",
            current
              ? "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              : "border-dashed border-zinc-300 bg-transparent italic text-zinc-400 dark:border-zinc-700 dark:text-zinc-600",
          )}
          title={current || "No default set"}
        >
          {current || "No default set"}
        </span>
        <Button
          variant="tertiary"
          onClick={() => void handleChoose()}
          className="shrink-0"
        >
          {current ? "Change…" : "Choose…"}
        </Button>
        {current && (
          <Button
            variant="ghost"
            onClick={handleClear}
            className="shrink-0"
          >
            Clear
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Pre-selects this destination when you open Export to USB. If the
        path isn't currently mounted (stick unplugged), the dialog falls
        back to the folder picker. Remembered mount point, not an auto-
        detector — different sticks must be picked once.
      </p>
    </div>
  );
}

function SampleRateChip({
  label,
  isActive,
  onSelect,
}: {
  rate: DefaultSampleRate;
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={cn(
        "rounded-md border px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
        isActive
          ? "border-brand-500 bg-brand-50 text-brand-900 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-100"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// MIDI section
// ---------------------------------------------------------------------------

/**
 * MIDI cleaning settings. The toggle controls whether `.mid` files
 * imported into a song folder get auto-cleaned (non-essential meta
 * events stripped — see Rust midi.rs for the keep/strip rules).
 *
 * Toggling the switch from off to on triggers a retroactive scan:
 * if any existing song-folder MIDI files would be cleaned, we offer
 * to clean them in place via a confirm dialog. Source-folder files
 * are never touched.
 */
function MidiSection() {
  const { state, setUserPrefs } = useAppState();
  const enabled = state.userPrefs.cleanMidiOnImport;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleToggle = async (next: boolean) => {
    if (busy) return;
    // Persist the new value immediately so the toggle moves and any
    // future imports respect it. The retroactive prompt is a separate
    // user choice that doesn't gate the toggle.
    setUserPrefs({ cleanMidiOnImport: next });
    if (!next) {
      setStatus(null);
      return;
    }

    // Toggle was just turned ON — offer retroactive clean.
    setBusy(true);
    setStatus("Scanning song folders…");
    try {
      const dirty = await scanForDirtyMidi(state.scan.songs);
      if (dirty.length === 0) {
        setStatus("All MIDI files in your song folders are already clean.");
        setBusy(false);
        return;
      }
      const songCount = new Set(dirty.map((d) => d.songFolder)).size;
      const proceed = await ask(
        `Found ${dirty.length} MIDI file${dirty.length === 1 ? "" : "s"} ` +
          `across ${songCount} song${songCount === 1 ? "" : "s"} that ` +
          `would be cleaned.\n\nClean them now? Source-folder files ` +
          `won't be modified.`,
        {
          title: "Clean existing MIDI files?",
          kind: "info",
          okLabel: "Clean Now",
          cancelLabel: "Skip",
        },
      );
      if (!proceed) {
        setStatus(
          `Skipped retroactive clean. ${dirty.length} file${dirty.length === 1 ? "" : "s"} not yet cleaned.`,
        );
        setBusy(false);
        return;
      }
      setStatus(`Cleaning ${dirty.length}…`);
      let cleaned = 0;
      for (const d of dirty) {
        try {
          const r = await cleanMidiFile(d.path);
          if (r.wasModified) cleaned += 1;
        } catch (err) {
          // Continue; we'll surface the count we managed.
          console.error(`Clean failed for ${d.path}:`, err);
        }
      }
      setStatus(
        `Cleaned ${cleaned} of ${dirty.length} file${dirty.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setStatus(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Auto-clean imported MIDI files
          </p>
          <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Strip non-essential meta events (markers, time signatures, key
            signatures, track names, etc.) from MIDI files copied into
            song folders. Keeps program changes, control changes, notes,
            tempo, and the end-of-track marker — what your downstream
            device actually needs. Files in source folders are never
            modified.
          </p>
        </div>
        <ToggleSwitch
          isOn={enabled}
          disabled={busy}
          onToggle={() => void handleToggle(!enabled)}
          ariaLabel="Auto-clean imported MIDI files"
        />
      </div>
      {status && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {status}
        </p>
      )}
    </section>
  );
}

/**
 * USB export — currently one toggle, `exportOnlyReferencedFiles`.
 *
 * When on, the USB export only copies audio / MIDI files that are
 * referenced by at least one song's `.jcs`. Useful when song folders
 * have accumulated unused renders from earlier Logic exports and the
 * BandMate stick is space-constrained or the user wants a clean
 * shipping copy. Default is off — the live-rig reliability principle
 * says we don't quietly change export semantics. The working folder
 * stays the user's archive; the toggle changes only what gets
 * shipped to USB.
 *
 * No retroactive prompt here (unlike the MIDI section's clean-now
 * offer) — the toggle takes effect at the next export, and a
 * separate per-song "Clean up" affordance lives in the Song Folder
 * tab for users who want to delete unreferenced files from the
 * working folder itself.
 */
function ExportSection() {
  const { state, setUserPrefs } = useAppState();
  const enabled = state.userPrefs.exportOnlyReferencedFiles;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Only export referenced files
          </p>
          <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            When on, USB export skips audio / MIDI files in your song
            folders that aren't referenced by any song's{" "}
            <span className="font-mono">.jcs</span>. Saves space and
            time on USB writes when song folders accumulate unused
            takes. Your working folder stays as the full archive;
            only the USB stick gets the trimmed set.{" "}
            <span className="font-mono">.jcs</span>,{" "}
            <span className="font-mono">.jcp</span>, and{" "}
            <span className="font-mono">.jcm</span> files always ship.
          </p>
        </div>
        <ToggleSwitch
          isOn={enabled}
          disabled={false}
          onToggle={() =>
            setUserPrefs({ exportOnlyReferencedFiles: !enabled })
          }
          ariaLabel="Only export referenced files"
        />
      </div>
    </section>
  );
}

/**
 * Walk every song folder, list its `.mid` files, and return the ones
 * that are not yet clean (i.e., `isMidiClean === false`). MIDI files
 * we couldn't parse (`isMidiClean === null`) are skipped — no point
 * trying to "clean" something we can't parse.
 *
 * Run sequentially to keep filesystem load light; song count is
 * typically small (handful to a few dozen).
 */
async function scanForDirtyMidi(
  songs: { folderPath: string }[],
): Promise<{ path: string; songFolder: string }[]> {
  const out: { path: string; songFolder: string }[] = [];
  for (const s of songs) {
    try {
      const files = await listAudioFiles(s.folderPath);
      for (const f of files) {
        if (f.kind === "mid" && f.isMidiClean === false) {
          out.push({ path: f.path, songFolder: s.folderPath });
        }
      }
    } catch {
      // Skip unreadable folders.
    }
  }
  return out;
}

/** Pill-style on/off switch — the standard iOS/macOS setting affordance. */
function ToggleSwitch({
  isOn,
  disabled,
  onToggle,
  ariaLabel,
}: {
  isOn: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
        isOn
          ? "bg-brand-500"
          : "bg-zinc-300 dark:bg-zinc-700",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
          isOn ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
