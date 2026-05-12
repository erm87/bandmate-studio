/**
 * USB-export "only ship referenced files" helpers.
 *
 * Two pieces of work happen here, both gated on the
 * `exportOnlyReferencedFiles` user preference:
 *
 *   1. `buildIncludeFilter` — parses every song's `.jcs` and returns
 *      the per-song allow-list (audio + MIDI filenames) sent to the
 *      Rust `export_to_usb` command. Cheap: only reads `.jcs` text.
 *
 *   2. `computeSkipSummary` — actually lists each song folder on
 *      disk so we can show the user "Skipping N unused file(s)
 *      (~M MB)" before they click Export, and surface a warning
 *      if any song would ship zero media files (likely a parse
 *      error or empty .jcs). Slower: hits the filesystem N times,
 *      and probes each WAV header to populate sizes.
 *
 * Both run on dialog open when the pref is on. The filter is also
 * passed to the Rust command at Start time.
 */

import type { ExportIncludeFilter } from "../fs/workingFolder";
import { listAudioFiles, readTextFile } from "../fs/workingFolder";
import { parseSong } from "../codec";
import { classifySongFolderFiles } from "./references";
import type { ScanResult } from "../fs/types";

/** Result of walking every song folder to compute the skip summary. */
export interface SkipSummary {
  /** Files that won't be copied because no `.jcs` references them. */
  fileCount: number;
  /** Total bytes those files would occupy on the USB stick. */
  byteCount: number;
  /**
   * Songs that would end up with zero media files on USB after the
   * filter runs. Empty string entries are song folder names. Only
   * populated when the song has WAV / MIDI files on disk but none
   * are referenced — typically a parse error or a stale folder. The
   * `.jcs` still ships, but the BandMate won't have audio.
   */
  songsWithZeroFiles: string[];
}

/**
 * Build the include-filter map for `export_to_usb`. Reads every
 * song's `.jcs` and collects its `<file>` + `<midi_file>` references.
 *
 * A song with an unreadable / unparseable `.jcs` is included with an
 * empty allow-list — meaning all of that song's media files get
 * skipped on export. The caller's UI surfaces this via
 * `computeSkipSummary`'s zero-files warning.
 */
export async function buildIncludeFilter(
  scan: ScanResult,
): Promise<ExportIncludeFilter> {
  const songs: Record<string, string[]> = {};
  await Promise.all(
    scan.songs.map(async (s) => {
      try {
        const text = await readTextFile(s.jcsPath);
        const song = parseSong(text);
        const refs = [
          ...song.audioFiles.map((f) => f.filename),
          ...(song.midiFile ? [song.midiFile.filename] : []),
        ];
        songs[s.folderName] = refs;
      } catch {
        // Unreadable / unparseable .jcs — empty allow-list. Surfaces
        // as a zero-files warning in computeSkipSummary, and on the
        // BandMate as "song with no audio" (the .jcs still ships).
        songs[s.folderName] = [];
      }
    }),
  );
  return { songs };
}

/**
 * Walk every song folder on disk + compare against the include
 * filter. Returns the count + byte total of files that would be
 * skipped, plus a list of songs that would have zero media after
 * the filter applies.
 *
 * Hits the disk once per song (`listAudioFiles` does a WAV-header
 * probe to populate `wavInfo` + sizes); for a typical working
 * folder this is sub-second. Run lazily after the user opens the
 * export dialog.
 */
export async function computeSkipSummary(
  scan: ScanResult,
  filter: ExportIncludeFilter,
): Promise<SkipSummary> {
  let fileCount = 0;
  let byteCount = 0;
  const songsWithZeroFiles: string[] = [];

  await Promise.all(
    scan.songs.map(async (s) => {
      const allowed = filter.songs[s.folderName] ?? [];
      // Use the same classification primitive that the per-song
      // cleanup uses — built around case-insensitive matching.
      // Wrapping the names into a synthetic Song lets the classifier
      // walk its `audioFiles` / `midiFile` shape without us having
      // to re-parse the .jcs. WAV references go into audioFiles
      // (channel doesn't matter for classification); MIDI ref goes
      // into midiFile.
      let files;
      try {
        files = await listAudioFiles(s.folderPath);
      } catch {
        return;
      }
      // Heuristic: anything ending in `.mid` (case-insensitive) is
      // a MIDI reference; everything else gets the WAV branch. The
      // codec already restricts midiFile to one entry so this is
      // sufficient.
      const wavRefs = allowed.filter(
        (n) => !n.toLowerCase().endsWith(".mid"),
      );
      const midRef = allowed.find((n) => n.toLowerCase().endsWith(".mid"));
      const syntheticSong = {
        sampleRate: 0,
        lengthSamples: 0,
        audioFiles: wavRefs.map((filename, i) => ({
          filename,
          channel: i,
          level: 0,
          pan: 0,
          mute: 0,
        })),
        midiFile: midRef
          ? { filename: midRef, channel: 0 }
          : undefined,
      };
      const { referenced, unreferenced } = classifySongFolderFiles(
        syntheticSong,
        files,
      );
      for (const f of unreferenced) {
        fileCount += 1;
        byteCount += f.sizeBytes ?? 0;
      }
      // Zero-media warning: the song folder has files but none are
      // referenced by the .jcs. The .jcs still ships, but the
      // BandMate will play silence.
      if (files.length > 0 && referenced.length === 0) {
        songsWithZeroFiles.push(s.folderName);
      }
    }),
  );

  return { fileCount, byteCount, songsWithZeroFiles };
}

/** Format a byte count as a short human-readable string. */
export function formatExportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
