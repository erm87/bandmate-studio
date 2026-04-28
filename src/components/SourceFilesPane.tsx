/**
 * Right-side pane that lists candidate source files (WAVs + MIDI) the
 * user can pull into channels.
 *
 * Phase 3c (current): read-only display, organized into Audio + MIDI
 * sections, each alphabetical. Severity coloring:
 *   - clean:    default zinc text
 *   - warning:  amber text + "Warning" badge (file plays on BandMate
 *               but is technically out-of-spec — re-bounce when
 *               convenient)
 *   - error:    red text + "Stereo" / "Bad" badge (cannot be used)
 *   - midi:     green text + "MIDI" badge
 *
 * Phase 3d wires click-to-assign + drag-drop.
 */

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listAudioFiles } from "../fs/workingFolder";
import type { AudioFileInfo } from "../fs/types";
import { cn } from "../lib/cn";

interface Props {
  /** Song folder, used as the default source folder on first mount. */
  songFolder: string;
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
}

export function SourceFilesPane({
  songFolder,
  songSampleRate,
  channelSelected,
  onSelectFile,
}: Props) {
  const [folder, setFolder] = useState<string>(songFolder);
  const [files, setFiles] = useState<AudioFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [folder]);

  const onPickFolder = async () => {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen === "string") setFolder(chosen);
  };

  // Rust already returns the listing alphabetized. Split by kind for
  // the section grouping.
  const audioFiles = files.filter((f) => f.kind === "wav");
  const midiFiles = files.filter((f) => f.kind === "mid");

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900/40">
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Source Files
          </h2>
          <button
            type="button"
            onClick={() => void onPickFolder()}
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Pick folder
          </button>
        </div>
        <p
          className="user-text truncate font-mono text-[10px] text-zinc-500"
          title={folder}
        >
          {pathTail(folder)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <PaneInfo>Loading…</PaneInfo>}
        {error && (
          <PaneInfo tone="error">Cannot list folder: {error}</PaneInfo>
        )}
        {!loading && !error && files.length === 0 && (
          <PaneInfo>
            No <span className="font-mono">.wav</span> or{" "}
            <span className="font-mono">.mid</span> files here.
          </PaneInfo>
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
    </aside>
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
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h3>
        <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
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
  // Disable when there's no place to put it: severity blocks it,
  // or it's audio with no channel highlighted.
  const isAssignable =
    severity !== "error" &&
    (file.kind === "mid" || channelSelected);

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
        onClick={onClick}
        disabled={!isAssignable}
        title={tooltipFor(file, classification, songSampleRate, channelSelected)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-4 py-1.5 text-sm text-left transition-colors last:border-b-0 dark:border-zinc-900",
          isAssignable
            ? "hover:bg-white dark:hover:bg-zinc-950"
            : "cursor-not-allowed opacity-60",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className={cn("user-text truncate font-mono text-xs", titleColor)}>
            {file.filename}
          </p>
          <p
            className={cn(
              "truncate text-[10px]",
              errorReason === "rate"
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500",
            )}
          >
            {subtitle}
          </p>
        </div>
        {severity === "midi" && <Tag tone="green">MIDI</Tag>}
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
        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
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
