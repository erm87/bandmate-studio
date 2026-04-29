/**
 * Snapshot-diff helpers used by the Undo History panel to label
 * each entry with a one-line description of what changed.
 *
 * One helper per editor (Song / Playlist / TrackMap) — each takes
 * two adjacent snapshots and returns a string. They match on the
 * FIRST difference they find, in priority order, so a single edit
 * that changes one field gets a precise label. If the diff doesn't
 * match a known pattern (e.g., reorder via splice that shifts many
 * indices at once), fall back to a generic descriptor.
 *
 * Labels return the FULL untruncated description (filenames and
 * all). The Undo History panel applies CSS `truncate` for the
 * in-panel display and threads the full string into the row's
 * `title` attribute so hovering reveals it in a native tooltip.
 */

import {
  MIDI_CHANNEL_INDEX,
  type Playlist,
  type Song,
  type TrackMap,
} from "../codec";

// ---------------------------------------------------------------------------
// Track Map
// ---------------------------------------------------------------------------

/**
 * Diff two `TrackMap`s. Detects single-cell label changes (the
 * common case — typing in a row's input) and falls back to
 * "Reordered channels" for splice-based reorders that shift many
 * indices at once.
 */
export function diffTrackMaps(prev: TrackMap, next: TrackMap): string {
  const changes: number[] = [];
  for (let i = 0; i < 25; i++) {
    if (prev.channels[i] !== next.channels[i]) changes.push(i);
  }
  if (changes.length === 0) return "Edit";
  // Single-cell change: type the new label as the description.
  if (changes.length === 1) {
    const idx = changes[0]!;
    const oldVal = prev.channels[idx]!;
    const newVal = next.channels[idx]!;
    const chLabel = idx === MIDI_CHANNEL_INDEX ? "MIDI slot" : `ch ${idx + 1}`;
    if (newVal === "") return `Cleared ${chLabel}`;
    if (oldVal === "") return `Set ${chLabel} to ${newVal}`;
    return `${chLabel}: ${newVal}`;
  }
  // Multiple changes — most likely a splice reorder.
  return "Reordered channels";
}

// ---------------------------------------------------------------------------
// Playlist
// ---------------------------------------------------------------------------

/**
 * Diff two `Playlist`s. Priority: header fields first
 * (displayName / sampleRate / trackMap), then song-list deltas.
 */
export function diffPlaylists(prev: Playlist, next: Playlist): string {
  if (prev.displayName !== next.displayName) {
    return `Renamed to "${next.displayName}"`;
  }
  if (prev.sampleRate !== next.sampleRate) {
    return `Sample rate: ${(next.sampleRate / 1000).toFixed(1)} kHz`;
  }
  if (prev.trackMap !== next.trackMap) {
    return `Track map: ${next.trackMap}`;
  }
  // songNames diff. Length change → add or remove. Same length but
  // different elements → reorder.
  const prevSongs = prev.songNames;
  const nextSongs = next.songNames;
  if (nextSongs.length > prevSongs.length) {
    const added = nextSongs.find((s) => !prevSongs.includes(s));
    return `Added "${added ?? "song"}"`;
  }
  if (nextSongs.length < prevSongs.length) {
    const removed = prevSongs.find((s) => !nextSongs.includes(s));
    return `Removed "${removed ?? "song"}"`;
  }
  return "Reordered songs";
}

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

/**
 * Diff two `Song`s. Pre-checks header fields, then audio assignments
 * (per-channel diff), then MIDI. Returns "Edit" only if literally
 * nothing detectable changed (shouldn't happen — applyEdit skips
 * no-op snapshots — but defensive).
 */
export function diffSongs(prev: Song, next: Song): string {
  if (prev.sampleRate !== next.sampleRate) {
    return `Sample rate: ${(next.sampleRate / 1000).toFixed(1)} kHz`;
  }

  // Audio-file deltas. Build per-channel maps so we can compare in
  // a stable order regardless of how audioFiles is sorted.
  const prevByCh = new Map<number, string>(
    prev.audioFiles.map((f) => [f.channel, f.filename]),
  );
  const nextByCh = new Map<number, string>(
    next.audioFiles.map((f) => [f.channel, f.filename]),
  );

  // Single-channel changes — the most common case.
  const changedChannels: number[] = [];
  const allChannels = new Set([
    ...prevByCh.keys(),
    ...nextByCh.keys(),
  ]);
  for (const ch of allChannels) {
    if (prevByCh.get(ch) !== nextByCh.get(ch)) changedChannels.push(ch);
  }
  if (changedChannels.length === 1) {
    const ch = changedChannels[0]!;
    const before = prevByCh.get(ch);
    const after = nextByCh.get(ch);
    const chLabel = `ch ${ch + 1}`;
    if (!after) return `Cleared ${chLabel}`;
    if (!before) return `Added ${after} → ${chLabel}`;
    return `${chLabel}: ${after}`;
  }
  if (changedChannels.length === 2) {
    // Common pattern: drag-move from A to B (A becomes empty, B gets
    // the file) or swap.
    const [a, b] = changedChannels.sort((x, y) => x - y) as [number, number];
    const aBefore = prevByCh.get(a);
    const aAfter = nextByCh.get(a);
    const bBefore = prevByCh.get(b);
    const bAfter = nextByCh.get(b);
    if (!aAfter && bAfter && aBefore === bAfter && !bBefore) {
      // Move A→B.
      return `Moved ${bAfter} to ch ${b + 1}`;
    }
    if (!bAfter && aAfter && bBefore === aAfter && !aBefore) {
      // Move B→A.
      return `Moved ${aAfter} to ch ${a + 1}`;
    }
    if (aBefore && bBefore && aAfter === bBefore && bAfter === aBefore) {
      // Pure swap.
      return `Swapped ch ${a + 1} ↔ ch ${b + 1}`;
    }
    // Some other 2-channel change — generic.
    return `Edited ch ${a + 1} & ch ${b + 1}`;
  }
  if (changedChannels.length > 2) {
    // Cascade-shift drop or similar block reorder.
    return `Shifted ${changedChannels.length} channels`;
  }

  // MIDI diff.
  const prevMidi = prev.midiFile?.filename ?? "";
  const nextMidi = next.midiFile?.filename ?? "";
  if (prevMidi !== nextMidi) {
    if (!nextMidi) return "Cleared MIDI";
    return `MIDI: ${nextMidi}`;
  }

  return "Edit";
}
