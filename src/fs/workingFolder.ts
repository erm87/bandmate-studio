/**
 * Typed wrappers around the Rust filesystem commands.
 *
 * The Rust side does the actual I/O (see `src-tauri/src/lib.rs`).
 * These functions are thin: marshal arguments, await the result,
 * surface errors.
 *
 * Why centralize: keeping all Tauri `invoke` calls behind named
 * helpers means tests / future refactors can mock at one place,
 * and React components don't import Tauri primitives directly.
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AudioFileInfo, ScanResult } from "./types";

/**
 * Show the native folder picker. Returns the chosen absolute path,
 * or `null` if the user cancelled.
 */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  if (typeof result === "string") return result;
  return null;
}

/**
 * Ensure the bm_media/ subtree exists under the chosen folder.
 * Idempotent — safe to call on an already-initialized folder.
 */
export async function initWorkingFolder(path: string): Promise<void> {
  await invoke<void>("init_working_folder", { path });
}

/**
 * Enumerate songs / playlists / track maps under the chosen folder.
 * Returns empty arrays for any subdirectory that doesn't exist.
 */
export async function scanWorkingFolder(path: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_working_folder", { path });
}

/**
 * One-shot: initialize the working folder if needed, then scan it.
 * The combined operation we always want when the user selects a folder
 * (or when restoring on app launch).
 */
export async function initAndScan(path: string): Promise<ScanResult> {
  await initWorkingFolder(path);
  return scanWorkingFolder(path);
}

/**
 * Read a UTF-8 text file (passes through to Rust). Used together with
 * the codec library to load .jcm/.jcs/.jcp contents.
 */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/**
 * Write a UTF-8 text file (overwrites if exists).
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke<void>("write_text_file", { path, content });
}

// ---------------------------------------------------------------------------
// Source-files-pane support (Phase 3)
// ---------------------------------------------------------------------------

/**
 * List `*.wav` and `*.mid` files in `folder`, with WAV header info
 * baked in for each WAV. One roundtrip vs. N per file.
 */
export async function listAudioFiles(folder: string): Promise<AudioFileInfo[]> {
  return invoke<AudioFileInfo[]>("list_audio_files", { folder });
}

/**
 * Copy a file into a folder. Overwrites if a file with the same name
 * already exists. Creates `destDir` if missing.
 *
 * Returns the destination path on success.
 */
export async function copyIntoFolder(
  src: string,
  destDir: string,
): Promise<string> {
  return invoke<string>("copy_into_folder", { src, destDir });
}

/** Outcome of a MIDI clean operation. Mirrors the Rust `CleanResult`. */
export interface MidiCleanResult {
  /** True if the file was rewritten. False = file was already clean. */
  wasModified: boolean;
  /** Number of events stripped across all tracks. */
  eventsRemoved: number;
}

/**
 * Strip non-essential meta events from a MIDI file in place. Atomic
 * (temp file + rename); see Rust `midi.rs` for the keep/strip rules.
 * No-op on already-clean files.
 */
export async function cleanMidiFile(path: string): Promise<MidiCleanResult> {
  return invoke<MidiCleanResult>("clean_midi_file", { path });
}

/**
 * One-off "is this MIDI clean?" probe. The same result is included
 * in `listAudioFiles`'s output as `isMidiClean` — use this only for
 * post-clean re-checks or other one-off needs.
 */
export async function isMidiClean(path: string): Promise<boolean> {
  return invoke<boolean>("is_midi_clean", { path });
}

/** True if a file exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

/**
 * Open the OS file manager and (where supported) highlight the given
 * path. macOS uses `open -R`, Windows uses `explorer /select,`,
 * Linux falls back to opening the parent folder via `xdg-open`.
 */
export async function revealInFileManager(path: string): Promise<void> {
  await invoke<void>("reveal_in_file_manager", { path });
}

// ---------------------------------------------------------------------------
// Phase 6 — USB Export
// ---------------------------------------------------------------------------

/** Mirrors the Rust `ExportProgress` struct emitted on "export-progress". */
export interface ExportProgress {
  currentFile: string;
  filesCopied: number;
  totalFiles: number;
  bytesCopied: number;
  totalBytes: number;
}

/** Mirrors the Rust `ExportSummary`. */
export interface ExportSummary {
  filesCopied: number;
  bytesCopied: number;
  /** True if dot_clean -m ran on macOS. False on other platforms. */
  dotCleaned: boolean;
}

/**
 * Copy the working folder's bm_media/ tree to `<destPath>/bm_media/`,
 * emitting per-file "export-progress" events along the way. After the
 * copy, runs `dot_clean -m <destPath>` on macOS to strip ._ files.
 *
 * The frontend should subscribe to "export-progress" via Tauri's
 * event API before calling this (see `subscribeExportProgress`) so
 * the dialog can update in real time.
 */
export async function exportToUsb(
  workingFolder: string,
  destPath: string,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_to_usb", { workingFolder, destPath });
}

/**
 * Subscribe to per-file progress events emitted during `exportToUsb`.
 * Returns an unsubscribe function — call it in cleanup.
 *
 * Tauri's event system delivers events to whichever windows have
 * subscribed; we have one main window, so this is straightforward.
 */
export async function subscribeExportProgress(
  callback: (progress: ExportProgress) => void,
): Promise<() => void> {
  // Lazy-import to avoid pulling the event API into the bundle until
  // export is actually in use.
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ExportProgress>("export-progress", (e) => {
    callback(e.payload);
  });
}

/**
 * Eject the volume mounted at `path` (macOS only — `diskutil eject`).
 * Returns true if the eject command ran. Other platforms return
 * false; the UI should fall back to a "please eject manually"
 * message in that case.
 */
export async function ejectVolume(path: string): Promise<boolean> {
  return invoke<boolean>("eject_volume", { path });
}

// ---------------------------------------------------------------------------
// Phase 3f — New Song wizard
// ---------------------------------------------------------------------------

/** Mirrors the Rust `CreatedSong` struct. */
export interface CreatedSong {
  /** Absolute path of the new song folder. */
  folderPath: string;
  /** Absolute path the empty .jcs should be written to. */
  jcsPath: string;
}

/**
 * Create a new empty song folder under `<workingFolder>/bm_media/bm_sources/<songName>/`.
 *
 * Does NOT write the .jcs — caller is expected to follow up with a
 * `writeTextFile(result.jcsPath, writeSong(emptySong))` call. Keeping
 * file generation on the TS side means the codec library remains the
 * single authority on .jcs format.
 *
 * Throws if the folder already exists, the name is invalid, or the
 * working folder is missing.
 */
export async function createSong(
  workingFolder: string,
  songName: string,
): Promise<CreatedSong> {
  return invoke<CreatedSong>("create_song", { workingFolder, songName });
}

/**
 * Per-song sidecar: `<song-folder>/.bandmate-studio.json`. Used to
 * stash BandMate Studio-only metadata (currently the external source
 * folder for the source-files pane). The dotfile prefix means the
 * BandMate hardware filters it out, and the file lives next to the
 * .jcs so it travels when the working folder is moved.
 */
export interface SongSidecar {
  /** Where the user picked their unimported WAVs from, or null/undefined. */
  sourceFolder?: string | null;
}

/**
 * Read the sidecar JSON for a song. Returns an empty object if there
 * is no sidecar (the common case for songs created by JoeCo's BM
 * Loader before BandMate Studio existed).
 */
export async function readSongSidecar(songFolder: string): Promise<SongSidecar> {
  const raw = await invoke<string | null>("read_song_sidecar", { songFolder });
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as SongSidecar;
    }
    return {};
  } catch {
    // Corrupt sidecar → behave as if absent. Don't surface this to the
    // user — they probably didn't write it themselves.
    return {};
  }
}

/** Persist sidecar JSON for a song. Overwrites prior contents. */
export async function writeSongSidecar(
  songFolder: string,
  sidecar: SongSidecar,
): Promise<void> {
  await invoke<void>("write_song_sidecar", {
    songFolder,
    content: JSON.stringify(sidecar, null, 2),
  });
}

// ---------------------------------------------------------------------------
// Phase 4 — New Playlist wizard
// ---------------------------------------------------------------------------

/** Mirrors the Rust `CreatedPlaylist` struct. */
export interface CreatedPlaylist {
  /** Absolute path the empty .jcp should be written to. */
  jcpPath: string;
}

/** Mirrors the Rust `CreatedTrackMap` struct. */
export interface CreatedTrackMap {
  /** Absolute path the empty .jcm should be written to. */
  jcmPath: string;
}

/**
 * Reserve a `.jcm` filename under
 * `<workingFolder>/bm_media/bm_trackmaps/`. Returns the path the
 * caller should `writeTextFile` the new track map into.
 */
export async function createTrackMap(
  workingFolder: string,
  name: string,
): Promise<CreatedTrackMap> {
  return invoke<CreatedTrackMap>("create_track_map", { workingFolder, name });
}

/**
 * Reserve a `.jcp` filename under `<workingFolder>/bm_media/`. Returns
 * the path the caller should `writeTextFile` the empty playlist into.
 *
 * Does NOT write the .jcp — caller follows up with
 * `writeTextFile(result.jcpPath, writePlaylist(emptyPlaylist))`.
 *
 * Throws if the file already exists, the name is invalid, or the
 * working folder is missing.
 */
export async function createPlaylist(
  workingFolder: string,
  name: string,
): Promise<CreatedPlaylist> {
  return invoke<CreatedPlaylist>("create_playlist", { workingFolder, name });
}

// ---------------------------------------------------------------------------
// Phase 4 — Delete + Duplicate
// ---------------------------------------------------------------------------

/** Recursively delete a song folder + all contents. */
export async function deleteSong(
  workingFolder: string,
  songFolder: string,
): Promise<void> {
  await invoke<void>("delete_song", { workingFolder, songFolder });
}

/** Delete a single .jcp playlist file. */
export async function deletePlaylist(
  workingFolder: string,
  jcpPath: string,
): Promise<void> {
  await invoke<void>("delete_playlist", { workingFolder, jcpPath });
}

/** Delete a single .jcm track-map file. */
export async function deleteTrackMap(
  workingFolder: string,
  jcmPath: string,
): Promise<void> {
  await invoke<void>("delete_track_map", { workingFolder, jcmPath });
}

/**
 * Duplicate a song: copies the folder + all WAVs + .jcs, renaming the
 * inner .jcs to match `newName`.
 */
export async function duplicateSong(
  workingFolder: string,
  sourceName: string,
  newName: string,
): Promise<CreatedSong> {
  return invoke<CreatedSong>("duplicate_song", {
    workingFolder,
    sourceName,
    newName,
  });
}

/** Duplicate a .jcp playlist file under a new name. */
export async function duplicatePlaylist(
  workingFolder: string,
  sourcePath: string,
  newName: string,
): Promise<CreatedPlaylist> {
  return invoke<CreatedPlaylist>("duplicate_playlist", {
    workingFolder,
    sourcePath,
    newName,
  });
}

/** Duplicate a .jcm track-map file under a new name. Returns the new path. */
export async function duplicateTrackMap(
  workingFolder: string,
  sourcePath: string,
  newName: string,
): Promise<string> {
  return invoke<string>("duplicate_track_map", {
    workingFolder,
    sourcePath,
    newName,
  });
}

/**
 * Rename a song's folder + its inner .jcs to match the new name.
 * Cross-reference cleanup (updating `<song_name>` in playlists)
 * happens on the TS side BEFORE calling this — see Sidebar.handleRenameSong.
 */
export async function renameSong(
  workingFolder: string,
  oldName: string,
  newName: string,
): Promise<CreatedSong> {
  return invoke<CreatedSong>("rename_song", { workingFolder, oldName, newName });
}

/**
 * Rename a .jcp file. Caller should update `<playlist_display_name>`
 * inside the file first if they want the on-screen name on the
 * BandMate to match.
 */
export async function renamePlaylist(
  workingFolder: string,
  oldPath: string,
  newName: string,
): Promise<CreatedPlaylist> {
  return invoke<CreatedPlaylist>("rename_playlist", {
    workingFolder,
    oldPath,
    newName,
  });
}

/** Rename a .jcm track-map file. Returns the new path. */
export async function renameTrackMap(
  workingFolder: string,
  oldPath: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_track_map", {
    workingFolder,
    oldPath,
    newName,
  });
}
