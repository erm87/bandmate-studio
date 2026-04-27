/**
 * WAV-probing helpers.
 *
 * The actual file I/O happens in Rust (see `src-tauri/src/lib.rs::probe_wav`)
 * because hound is faster, simpler, and more reliable than reading WAV
 * headers in JavaScript. This module wraps the Tauri `invoke` call so
 * React components get a clean typed API.
 */

import { invoke } from "@tauri-apps/api/core";
import type { WavInfo } from "./types";

/**
 * Read the header of a WAV file at the given absolute path.
 *
 * Throws if the file doesn't exist or isn't a valid WAV. The error
 * message will indicate which.
 */
export async function probeWav(path: string): Promise<WavInfo> {
  return invoke<WavInfo>("probe_wav", { path });
}

/**
 * True if the file at `path` is a mono WAV (BandMate's hard requirement
 * for source audio files). Returns false for stereo or unreadable files.
 */
export async function isMonoWav(path: string): Promise<boolean> {
  try {
    const info = await probeWav(path);
    return info.channels === 1;
  } catch {
    return false;
  }
}
