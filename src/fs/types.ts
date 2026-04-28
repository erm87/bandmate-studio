/**
 * Types matching the Rust filesystem command return shapes.
 *
 * Each interface here corresponds 1:1 to a `#[derive(Serialize)]` struct
 * in `src-tauri/src/lib.rs`. The Rust side uses `#[serde(rename_all = "camelCase")]`
 * so JSON keys arrive in camelCase.
 *
 * Do not confuse these with the codec-level types (`Song`, `Playlist`,
 * `TrackMap` in `src/codec/types.ts`). Those are the *parsed* contents
 * of files; these are *summaries* of files on disk (paths only —
 * lightweight enough to load eagerly for sidebar lists).
 */

export interface SongSummary {
  /** Folder name (= song name in the UI). e.g. "Buffy" */
  folderName: string;
  /** Absolute path to the song folder. */
  folderPath: string;
  /** Absolute path to the <folder_name>.jcs file inside that folder. */
  jcsPath: string;
}

export interface PlaylistSummary {
  /** Filename including extension. e.g. "May v3.jcp" */
  filename: string;
  /** Absolute path to the .jcp file. */
  path: string;
}

export interface TrackMapSummary {
  /** Filename including extension. e.g. "erictest_tm.jcm" */
  filename: string;
  /** Absolute path to the .jcm file. */
  path: string;
}

export interface ScanResult {
  songs: SongSummary[];
  playlists: PlaylistSummary[];
  trackMaps: TrackMapSummary[];
}

/**
 * One entry returned by `list_audio_files`. Includes WAV header info
 * baked in so the frontend can decide stereo / mono / playable
 * without a second roundtrip per file.
 *
 * The `diagnostic` field carries severity-classified probe results:
 *   - null:     clean file, no issues
 *   - warning:  technically out-of-spec but the BandMate plays it
 *               (e.g., region-cut WAVs where the data chunk length
 *               isn't a clean multiple of the sample size). `wavInfo`
 *               IS populated for warning files via a lenient header
 *               fallback.
 *   - error:    file cannot be used (stereo, missing fmt chunk,
 *               unreadable, etc.). `wavInfo` is null.
 */
export interface AudioFileInfo {
  filename: string;
  path: string;
  /** Lowercased extension: "wav" or "mid". */
  kind: "wav" | "mid";
  /** Populated for clean and warning-class WAV files; null for MIDI or hard errors. */
  wavInfo: import("../codec/types").WavInfo | null;
  /** Severity-classified probe result. */
  diagnostic: Diagnostic | null;
}

export type Diagnostic =
  | { severity: "warning"; message: string }
  | { severity: "error"; message: string };
