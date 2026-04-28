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

import type { Playlist, Song, TrackMap } from "./types";

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

// ---------------------------------------------------------------------------
// Track-map templates
// ---------------------------------------------------------------------------

/**
 * Identifier for one of the built-in label templates surfaced in the
 * New Track Map dialog.
 */
export type TrackMapTemplate = "empty" | "default" | "stems" | "brigades";

/**
 * User-facing description of each template — shown next to the radio
 * picker so the user can see what they're choosing before clicking
 * Create.
 */
export const TRACK_MAP_TEMPLATE_DESCRIPTIONS: Record<TrackMapTemplate, string> = {
  empty:
    "All 25 slots blank. Use when you'll define your channel layout from scratch.",
  default:
    "Generic numbered labels (Track 1 … Track 24, MIDI). Closest to BM Loader's default.",
  stems:
    "Multitrack drum / band stems (Kick, Snare, OH L/R, Bass, Gtrs, Keys, Vox, etc.). Good starting point for a band recording.",
  brigades:
    "Brigades' live rig layout (Lights / Click / RefL / RefR / Guitars / SynthSamples / 808s / Vox + Kemper on the MIDI slot). Matches erictest_tm.jcm.",
};

/** 25-slot template tables, indexed by template name. Index 24 is the MIDI slot. */
const TRACK_MAP_TEMPLATES: Record<TrackMapTemplate, string[]> = {
  empty: Array(25).fill(""),
  default: [
    "Track 1", "Track 2", "Track 3", "Track 4", "Track 5", "Track 6",
    "Track 7", "Track 8", "Track 9", "Track 10", "Track 11", "Track 12",
    "Track 13", "Track 14", "Track 15", "Track 16", "Track 17", "Track 18",
    "Track 19", "Track 20", "Track 21", "Track 22", "Track 23", "Track 24",
    "MIDI",
  ],
  stems: [
    "Kick In", "Kick Out", "Snare Top", "Snare Bot", "Hihat",
    "Tom 1", "Tom 2", "Floor Tom", "OH L", "OH R",
    "Bass DI", "Bass Amp",
    "Gtr 1", "Gtr 2",
    "Keys L", "Keys R",
    "Vox Lead", "BGV L", "BGV R",
    "Click", "Refs",
    "", "", "",
    "MIDI",
  ],
  // Matches Eric's erictest_tm.jcm exactly so the "Brigades-style"
  // template plays nice with his existing playlist + song set.
  brigades: [
    "Lights", "Click", "RefL", "RefR", "Guitars", "SynthSamples", "808s",
    "Vox",
    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    "Kemper",
  ],
};

/**
 * Build a `TrackMap` from one of the built-in templates. Used by the
 * New Track Map wizard. The result has exactly 25 channels — same
 * structure as a parsed `.jcm`.
 */
export function createEmptyTrackMap(template: TrackMapTemplate): TrackMap {
  const channels = TRACK_MAP_TEMPLATES[template];
  if (!channels || channels.length !== 25) {
    throw new Error(`Invalid track-map template: ${template}`);
  }
  // Defensive copy — the consumer mutates the array (e.g., via the
  // editor's snapshot model) and we don't want template tables to be
  // shared mutable state.
  return { channels: [...channels] };
}
