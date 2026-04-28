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

/** True if a file exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}
