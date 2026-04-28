/**
 * BandMate Studio file-format codec library.
 *
 * Pure-functional read/write for the three BandMate file formats:
 *   - .jcm — Track Map (channel name list)
 *   - .jcs — Song (audio + MIDI assignments per channel)
 *   - .jcp — Playlist (ordered list of song folder names)
 *
 * See SPEC.md at the repo root for the on-disk format reference.
 *
 * The codec is pure TypeScript (no Tauri or Node-specific APIs in the
 * read/write paths) so it can run in the browser, in a Tauri webview,
 * or under vitest in Node. It just deals in strings.
 *
 * The `WAV probe` (channel count, sample rate, duration) is the one
 * exception — that's a Tauri command in `src-tauri/src/lib.rs`, exposed
 * via `invoke('probe_wav', { path })` from the frontend.
 */

export { parseTrackMap, writeTrackMap } from "./jcm";
export { parseSong, writeSong } from "./jcs";
export { parsePlaylist, writePlaylist } from "./jcp";

export type {
  TrackMap,
  Song,
  SongAudioFile,
  SongMidiFile,
  Playlist,
  WavInfo,
} from "./types";

export {
  TRACK_MAP_CHANNEL_COUNT,
  MIDI_CHANNEL_INDEX,
} from "./types";

import type { Playlist, Song } from "./types";

/**
 * Build an empty `Song` with the given sample rate. Used by the New
 * Song wizard before any files are assigned. `lengthSamples` is 0 —
 * we recompute it on save from the longest assigned WAV.
 *
 * Round-tripping the result through `writeSong` then `parseSong`
 * should be identity (modulo whitespace), so saving an untouched
 * empty song is well-defined.
 */
export function createEmptySong(sampleRate: number): Song {
  if (sampleRate !== 44100 && sampleRate !== 48000) {
    throw new Error(
      `Unsupported sample rate ${sampleRate}; expected 44100 or 48000.`,
    );
  }
  return {
    sampleRate,
    lengthSamples: 0,
    audioFiles: [],
    // midiFile intentionally omitted (optional in the type).
  };
}

/**
 * Build an empty `Playlist`. Used by the New Playlist wizard before
 * any songs are added. Caller supplies the display name (which
 * doubles as the filename minus the extension), sample rate, and the
 * track-map filename to embed in `<trackmap>`.
 */
export function createEmptyPlaylist(
  displayName: string,
  sampleRate: number,
  trackMap: string,
): Playlist {
  if (sampleRate !== 44100 && sampleRate !== 48000) {
    throw new Error(
      `Unsupported sample rate ${sampleRate}; expected 44100 or 48000.`,
    );
  }
  return {
    displayName,
    sampleRate,
    trackMap,
    songNames: [],
  };
}
