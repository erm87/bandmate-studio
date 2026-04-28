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
