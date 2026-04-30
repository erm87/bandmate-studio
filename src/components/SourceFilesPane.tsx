/**
 * Right-side pane that shows the files available to assign to channels.
 *
 * Two views, switchable via tabs:
 *
 *   - **Song Folder** — files already imported into this song's folder.
 *     These ship to the BandMate USB stick alongside the .jcs.
 *
 *   - **Source Folder** — an external "import-from" folder (typically a
 *     Logic export folder). Files here haven't been copied yet; clicking
 *     a row queues the file for import — the actual copy happens on
 *     save (along with .jcs writeback).
 *
 * The Source Folder choice persists on the song's `.bandmate-studio.json`
 * sidecar, so reopening the song restores the same external source.
 *
 * Severity coloring on rows (unchanged from earlier phases):
 *   - clean:    default zinc text
 *   - warning:  amber text + "Warning" badge (file plays on BandMate
 *               but is technically out-of-spec — re-bounce when
 *               convenient)
 *   - error:    red text + "Stereo" / "Rate" / "Bad" badge — blocked
 *   - midi:     green text + "MIDI" badge
 */

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listAudioFiles, revealInFileManager } from "../fs/workingFolder";
import type { AudioFileInfo } from "../fs/types";
import { cn } from "../lib/cn";
import { setDragImageLabel, setDragPayload } from "../lib/dnd";
import { ContextMenu, type OpenContextMenu } from "./ContextMenu";

type Tab = "song" | "source";

interface Props {
  /** Absolute path of the song's own folder. Always available. */
  songFolder: string;
  /**
   * Absolute path of the external source folder, or `null` if none has
   * been chosen for this song. Persisted in the song's sidecar.
   */
  sourceFolder: string | null;
  /**
   * The song's currently-selected sample rate (Hz). Source WAVs that
   * don't match are flagged as errors and can't be assigned — the
   * BandMate plays them at the wrong speed/pitch otherwise.
   */
  songSampleRate: number;
  /** True if the user has highlighted a channel in the grid. */
  channelSelected: boolean;
  /**
   * Callback fired when the user clicks a source row. Implementations
   * decide which channel to assign to (audio uses the highlighted
   * channel; MIDI always lands on slot 24).
   */
  onSelectFile: (file: AudioFileInfo) => void;
  /**
   * Called when the user picks (or changes) the external source folder.
   * Parent persists to the sidecar.
   */
  onChangeSourceFolder: (path: string) => void;
  /**
   * Called when the user wants to drop the external source. Parent
   * clears the sidecar entry.
   */
  onClearSourceFolder: () => void;
  /**
   * Bump this number to force the Song Folder tab to re-list its
   * files. Needed after save (auto-clean may have rewritten a MIDI
   * file in place) or after a manual clean. The Source Folder tab
   * doesn't need it — source files are never modified by us.
   */
  songFolderRefreshKey?: number;
}

export function SourceFilesPane({
  songFolder,
  sourceFolder,
  songSampleRate,
  channelSelected,
  onSelectFile,
  onChangeSourceFolder,
  onClearSourceFolder,
  songFolderRefreshKey,
}: Props) {
  // Default to whichever tab is more useful: source if one's set, else
  // song folder. The pane remounts per song (SongEditor uses a `key`),
  // so this initialization runs fresh on each song open.
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    sourceFolder ? "source" : "song",
  );

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900/40">
      <TabBar
        activeTab={activeTab}
        onChange={setActiveTab}
        sourceFolderSet={sourceFolder !== null}
      />

      {activeTab === "song" ? (
        <FolderView
          folder={songFolder}
          // Bump on save / manual clean so MIDI cleanliness badges
          // reflect the post-clean state. Source-folder files don't
          // need this — we never modify them.
          refreshKey={songFolderRefreshKey ?? 0}
          helper={
            <>
              Files already imported into this song. These ship to the
              BandMate USB along with the <span className="font-mono">.jcs</span> when you export.
            </>
          }
          songSampleRate={songSampleRate}
          channelSelected={channelSelected}
          onSelectFile={onSelectFile}
          // Song folder is fixed to the song; no folder picker.
          headerAction={null}
          emptyHint={
            <>
              Empty for now. Switch to the <strong>Source Folder</strong> tab to
              import files into this song.
            </>
          }
        />
      ) : sourceFolder ? (
        <FolderView
          folder={sourceFolder}
          refreshKey={0}
          helper={
            <>
              Unimported files from an external folder (e.g., a Logic export).
              Click a file to queue it; it copies into the song folder when
              you save.
            </>
          }
          songSampleRate={songSampleRate}
          channelSelected={channelSelected}
          onSelectFile={onSelectFile}
          headerAction={
            <SourceFolderHeaderActions
              onChange={() => void pickFolder(onChangeSourceFolder)}
              onClear={onClearSourceFolder}
            />
          }
          emptyHint={
            <>
              No <span className="font-mono">.wav</span> or{" "}
              <span className="font-mono">.mid</span> files in this folder.
            </>
          }
        />
      ) : (
        <SourceFolderEmptyState
          onPick={() => void pickFolder(onChangeSourceFolder)}
        />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  activeTab,
  onChange,
  sourceFolderSet,
}: {
  activeTab: Tab;
  onChange: (t: Tab) => void;
  sourceFolderSet: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Files pane view"
      className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800"
    >
      <TabButton
        label="Song Folder"
        isActive={activeTab === "song"}
        onClick={() => onChange("song")}
        // Tooltip carries the longer explanation so the bar itself stays terse.
        title="Files imported into this song. Saved to the BandMate USB stick."
      />
      <TabButton
        label="Source Folder"
        isActive={activeTab === "source"}
        onClick={() => onChange("source")}
        title={
          sourceFolderSet
            ? "External folder for unimported files (Logic export, etc.). Click a file to queue it for import."
            : "Choose an external folder of unimported files to pull into this song."
        }
      />
    </div>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
  title,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      title={title}
      className={cn(
        "relative flex flex-1 items-center justify-center border-b-2 px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400",
        isActive
          ? "border-brand-500 text-zinc-900 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Folder view — used for both tabs
// ---------------------------------------------------------------------------

function FolderView({
  folder,
  refreshKey,
  helper,
  songSampleRate,
  channelSelected,
  onSelectFile,
  headerAction,
  emptyHint,
}: {
  folder: string;
  /**
   * Bumping this number forces a re-list of `folder`. Used by the
   * Song Folder tab so MIDI cleanliness badges reflect post-save and
   * post-manual-clean state. The Source Folder tab passes 0 (we never
   * modify source files, so no refresh is needed).
   */
  refreshKey: number;
  helper: React.ReactNode;
  songSampleRate: number;
  channelSelected: boolean;
  onSelectFile: (file: AudioFileInfo) => void;
  headerAction: React.ReactNode | null;
  emptyHint: React.ReactNode;
}) {
  const [files, setFiles] = useState<AudioFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAudioFiles(folder)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder, refreshKey]);

  const audioFiles = files.filter((f) => f.kind === "wav");
  const midiFiles = files.filter((f) => f.kind === "mid");

  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <p
            className="user-text min-w-0 flex-1 cursor-context-menu truncate self-center font-mono text-2xs text-zinc-500"
            title={folder}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                position: { x: e.clientX, y: e.clientY },
                items: [
                  {
                    label: "Open in Finder",
                    onClick: () => void revealInFileManager(folder),
                  },
                ],
              });
            }}
          >
            {pathTail(folder)}
          </p>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
        <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
          {helper}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <PaneInfo>Loading…</PaneInfo>}
        {error && (
          <PaneInfo tone="error">Cannot list folder: {error}</PaneInfo>
        )}
        {!loading && !error && files.length === 0 && (
          <PaneInfo>{emptyHint}</PaneInfo>
        )}
        {!loading && !error && files.length > 0 && (
          <>
            <Section title="Audio" count={audioFiles.length}>
              {audioFiles.length === 0 ? (
                <PaneInfo>No <span className="font-mono">.wav</span> files.</PaneInfo>
              ) : (
                audioFiles.map((f) => (
                  <SourceFileRow
                    key={f.path}
                    file={f}
                    songSampleRate={songSampleRate}
                    channelSelected={channelSelected}
                    onClick={() => onSelectFile(f)}
                  />
                ))
              )}
            </Section>
            <Section title="MIDI" count={midiFiles.length}>
              {midiFiles.length === 0 ? (
                <PaneInfo>No <span className="font-mono">.mid</span> files.</PaneInfo>
              ) : (
                midiFiles.map((f) => (
                  <SourceFileRow
                    key={f.path}
                    file={f}
                    songSampleRate={songSampleRate}
                    /* MIDI doesn't need a channel pre-selected — it
                       always lands on slot 24. So this stays clickable
                       regardless of the highlight state. */
                    channelSelected={true}
                    onClick={() => onSelectFile(f)}
                  />
                ))
              )}
            </Section>
          </>
        )}
      </div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}

function SourceFolderHeaderActions({
  onChange,
  onClear,
}: {
  onChange: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onClear}
        title="Stop using this source folder for the song"
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onChange}
        className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Change…
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source-folder empty state
// ---------------------------------------------------------------------------

function SourceFolderEmptyState({ onPick }: { onPick: () => void }) {
  // Sits near the top of the pane (not flex-1 / justify-center) so the
  // explainer reads as in-flow content, not a centered empty-state
  // splash. Bottom padding keeps the CTA from butting up against the
  // pane boundary if the user resizes the window short.
  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-10 text-center">
      <FolderPlusIcon className="mb-3 h-8 w-8 text-zinc-400 dark:text-zinc-600" />
      <h3 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        No source folder set
      </h3>
      <p className="mb-4 max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        A <strong>source folder</strong> is where you keep your unimported
        WAVs — typically a Logic Pro export folder. Files appear in this tab,
        and clicking one queues it; it copies into the{" "}
        <strong>song folder</strong> when you save. Pointing at the right
        folder once means the next bounce just shows up here.
      </p>
      <button
        type="button"
        onClick={onPick}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
      >
        Choose folder…
      </button>
    </div>
  );
}

/** Folder + plus glyph for the empty state. */
function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M12 11v6" />
      <path d="M9 14h6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
      <header className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <h3 className="eyebrow">
          {title}
        </h3>
        <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-2xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {count}
        </span>
      </header>
      <ul className="pb-2">{children}</ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type RowSeverity = "clean" | "warning" | "error" | "midi";

/** What's specifically wrong with an error-class file. */
type ErrorReason = "stereo" | "corrupt" | "rate";

function classifyRow(
  file: AudioFileInfo,
  songSampleRate: number,
): { severity: RowSeverity; errorReason?: ErrorReason } {
  if (file.kind === "mid") return { severity: "midi" };
  if (file.diagnostic?.severity === "error") {
    return { severity: "error", errorReason: "corrupt" };
  }
  // Stereo WAVs are technically clean reads, but we treat them as
  // errors because BandMate rejects them.
  if ((file.wavInfo?.channels ?? 1) > 1) {
    return { severity: "error", errorReason: "stereo" };
  }
  // Sample-rate mismatch: BandMate plays files at the song's rate, so
  // a 44.1 file in a 48 song would shift speed/pitch. Block it.
  if (
    file.wavInfo &&
    file.wavInfo.sampleRate > 0 &&
    file.wavInfo.sampleRate !== songSampleRate
  ) {
    return { severity: "error", errorReason: "rate" };
  }
  if (file.diagnostic?.severity === "warning") return { severity: "warning" };
  return { severity: "clean" };
}

function SourceFileRow({
  file,
  songSampleRate,
  channelSelected,
  onClick,
}: {
  file: AudioFileInfo;
  songSampleRate: number;
  channelSelected: boolean;
  onClick: () => void;
}) {
  const classification = classifyRow(file, songSampleRate);
  const { severity, errorReason } = classification;
  // Click semantics: needs a channel target. Audio files require a
  // selected channel; MIDI always lands on slot 24 so it's always
  // click-assignable. Severity errors (stereo / corrupt / rate) block
  // both click and drag — there's no valid place to put them.
  const isClickAssignable =
    severity !== "error" &&
    (file.kind === "mid" || channelSelected);
  // Drag semantics: the user picks the target by dropping. So the
  // only thing that blocks drag is severity — channel selection is
  // irrelevant. (Issue raised in testing 2026-04-28: rows were dimmed
  // when no channel was selected, which also disabled drag.)
  const isDraggable = severity !== "error";

  // Subtitle: prefer the spec line (sample rate + ch + length) when
  // available — even on warning files, where we recovered the spec via
  // the lenient header fallback.
  const subtitle = (() => {
    if (file.kind === "mid") return "MIDI";
    if (severity === "error" && !file.wavInfo) {
      return file.diagnostic?.message ?? "Unreadable";
    }
    if (!file.wavInfo) return "—";
    const { sampleRate, channels, durationSeconds } = file.wavInfo;
    const mm = Math.floor(durationSeconds / 60);
    const ss = Math.floor(durationSeconds % 60)
      .toString()
      .padStart(2, "0");
    const chLabel = channels === 1 ? "mono" : `${channels}ch`;
    return `${(sampleRate / 1000).toFixed(1)} kHz · ${chLabel} · ${mm}:${ss}`;
  })();

  const titleColor = {
    clean: "text-zinc-700 dark:text-zinc-300",
    warning: "text-amber-700 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
    midi: "text-green-700 dark:text-green-400",
  }[severity];

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          // Silent no-op when click can't land anywhere — the tooltip
          // already explains the channel-selection requirement.
          if (isClickAssignable) onClick();
        }}
        draggable={isDraggable}
        onDragStart={(e) => {
          if (!isDraggable) return;
          setDragPayload(e, { kind: "source-file", file });
          // Custom drag image — just the filename, not the full row
          // with subtitle / badge / etc.
          setDragImageLabel(e, file.filename);
        }}
        title={tooltipFor(file, classification, songSampleRate, channelSelected)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-4 py-1.5 text-sm text-left transition-colors last:border-b-0 dark:border-zinc-900",
          isDraggable
            ? "cursor-grab hover:bg-white active:cursor-grabbing dark:hover:bg-zinc-950"
            : "cursor-not-allowed opacity-60",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className={cn("user-text truncate font-mono text-xs", titleColor)}>
            {file.filename}
          </p>
          <p
            className={cn(
              "truncate text-2xs",
              errorReason === "rate"
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500",
            )}
          >
            {subtitle}
          </p>
        </div>
        {severity === "midi" && (
          <>
            <Tag tone="green">MIDI</Tag>
            {/* Cleanliness pill — informational only for source-folder
                files (we never modify originals; the user can flip on
                "Auto-clean imported MIDI files" in Settings to clean
                copies on import). */}
            {file.isMidiClean === true && <Tag tone="green">Clean</Tag>}
            {file.isMidiClean === false && <Tag tone="amber">Not clean</Tag>}
          </>
        )}
        {severity === "warning" && <Tag tone="amber">Warning</Tag>}
        {severity === "error" && (
          <Tag tone="red">
            {errorReason === "stereo"
              ? "Stereo"
              : errorReason === "rate"
                ? "Rate"
                : "Bad"}
          </Tag>
        )}
      </button>
    </li>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "red" | "amber" | "green";
}) {
  const palette = {
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    green:
      "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  }[tone];
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider",
        palette,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Show the native folder picker; pass the chosen path to `onPick`. */
async function pickFolder(onPick: (path: string) => void): Promise<void> {
  const chosen = await open({ directory: true, multiple: false });
  if (typeof chosen === "string") onPick(chosen);
}

function PaneInfo({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <p
      className={cn(
        "px-4 py-3 text-xs italic",
        tone === "error"
          ? "text-red-600 dark:text-red-400"
          : "text-zinc-500 dark:text-zinc-600",
      )}
    >
      {children}
    </p>
  );
}

/** Show the trailing 3 path segments — keep the meaningful tail visible. */
function pathTail(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-3).join("/");
  return parts.length > 3 ? `…/${tail}` : `/${tail}`;
}

function tooltipFor(
  file: AudioFileInfo,
  classification: { severity: RowSeverity; errorReason?: ErrorReason },
  songSampleRate: number,
  channelSelected: boolean,
): string {
  const { severity, errorReason } = classification;
  const channelHint =
    file.kind === "wav" && severity !== "error" && !channelSelected
      ? "\n\nSelect a channel on the left first, then click here to assign."
      : "";

  if (severity === "error" && errorReason === "stereo") {
    return [
      "Stereo WAV — BandMate requires mono.",
      "",
      "Fix: re-bounce the source file as a mono WAV in your DAW",
      "(in Logic: select the track → File → Bounce in Place → Mono).",
    ].join("\n");
  }
  if (severity === "error" && errorReason === "rate") {
    const fileRate = file.wavInfo?.sampleRate ?? 0;
    return [
      `Sample rate mismatch — file is ${(fileRate / 1000).toFixed(1)} kHz, song is ${(songSampleRate / 1000).toFixed(1)} kHz.`,
      "",
      "The BandMate plays each file at the song's sample rate, so a",
      "mismatched file would shift in speed and pitch. Re-bounce the",
      `source at ${(songSampleRate / 1000).toFixed(1)} kHz, or change the song's sample rate to`,
      `${(fileRate / 1000).toFixed(1)} kHz, to use this file.`,
    ].join("\n");
  }
  if (severity === "error") {
    return [
      `Header unreadable: ${file.diagnostic?.message ?? "unknown"}`,
      "",
      "This file cannot be used. Re-bounce from your DAW (Logic:",
      "File → Bounce in Place, or File → Export → Audio File).",
    ].join("\n");
  }
  if (severity === "warning") {
    return (
      [
        `Out-of-spec but recoverable: ${file.diagnostic?.message ?? "unknown"}`,
        "",
        "Likely cause: the file was exported as a region cut, and the cut",
        "ended mid-sample, so the data chunk length isn't a clean multiple",
        "of the sample size.",
        "",
        "The BandMate hardware plays this file fine — its WAV parser",
        "(libsndfile) tolerates the malformation. Re-bouncing from your",
        "DAW will produce a strictly clean file if you want to silence",
        "this warning.",
      ].join("\n") + channelHint
    );
  }
  if (file.kind === "mid") {
    return `MIDI file — click to assign to channel 25 (the MIDI slot).\n${file.path}`;
  }
  return file.path + channelHint;
}
