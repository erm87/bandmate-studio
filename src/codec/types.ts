/**
 * TypeScript types matching the BandMate file formats.
 *
 * See SPEC.md (next to this file's repo root) for the source-of-truth
 * description of each format. The types here are the in-memory
 * representation we work with after parsing; codec functions in
 * `jcm.ts`, `jcs.ts`, `jcp.ts` convert to/from string representations.
 *
 * Naming convention: TypeScript-idiomatic camelCase, regardless of the
 * snake_case_or_lowercase used in the file format. The codec layer
 * does the translation.
 */

// ---------------------------------------------------------------------------
// .jcm — Track Map
// ---------------------------------------------------------------------------

/**
 * A track map describes the 25 channels (24 audio + 1 MIDI) by name.
 * Unused slots are empty strings; the array length is always 25.
 *
 * Example (Eric's `erictest_tm.jcm`):
 *   ['Lights', 'Click', 'RefL', 'RefR', 'Guitars', 'SynthSamples', '808s',
 *    'Vox', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
 *    'Kemper']
 */
export interface TrackMap {
  /** Channel labels, indexed 0..24. Always exactly 25 entries. */
  channels: string[];
}

/** Number of channels in a track map (24 audio + 1 MIDI = 25). */
export const TRACK_MAP_CHANNEL_COUNT = 25;
export const MIDI_CHANNEL_INDEX = 24;

// ---------------------------------------------------------------------------
// .jcs — Song
// ---------------------------------------------------------------------------

/** A single audio file assigned to a channel within a song. */
export interface SongAudioFile {
  /** Filename (no path) of the WAV in the song folder. */
  filename: string;
  /** Output channel index (0..23 for audio). */
  channel: number;
  /** Gain multiplier (typically 1.0 = unity). */
  level: number;
  /** Stereo pan: 0.0 = left, 0.5 = center, 1.0 = right. */
  pan: number;
  /** Mute flag as a float: 1.0 = NOT muted, 0.0 = muted. */
  mute: number;
}

/** The MIDI track for a song, stored in a separate `<midi_file>` element. */
export interface SongMidiFile {
  /** Filename (no path) of the .mid in the song folder. */
  filename: string;
  /** Output channel index (always 24 by convention; the MIDI slot). */
  channel: number;
}

/** A song: multiple audio files, optionally one MIDI file, and metadata. */
export interface Song {
  /** Sample rate in Hz: 44100 or 48000. */
  sampleRate: number;
  /**
   * Total length in samples. Stock BM Loader sets this to the longest
   * WAV's sample count. We compute the same on save.
   */
  lengthSamples: number;
  /** Audio files, in the order they appear in the file. */
  audioFiles: SongAudioFile[];
  /** Optional single MIDI file. */
  midiFile?: SongMidiFile;
}

// ---------------------------------------------------------------------------
// .jcp — Playlist
// ---------------------------------------------------------------------------

/** A playlist: an ordered list of song folder names plus metadata. */
export interface Playlist {
  /** User-visible playlist name (shown on the BandMate screen). */
  displayName: string;
  /** Sample rate in Hz: should match every song's sample rate. */
  sampleRate: number;
  /** Filename of the `.jcm` track map this playlist uses. */
  trackMap: string;
  /** Ordered song folder names. Each must match a folder under bm_sources/. */
  songNames: string[];
}

// ---------------------------------------------------------------------------
// WAV probe — populated by the Rust `probe_wav` Tauri command
// ---------------------------------------------------------------------------

/** Result of probing a WAV file's header (no audio data is read). */
export interface WavInfo {
  /** Number of audio channels: 1 = mono, 2 = stereo. BandMate requires mono. */
  channels: number;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Bit depth (16 / 24 / 32). */
  bitDepth: number;
  /** Total length in samples. */
  durationSamples: number;
  /** Total length in seconds (durationSamples / sampleRate). */
  durationSeconds: number;
}
