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
