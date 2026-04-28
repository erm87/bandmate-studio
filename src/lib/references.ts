/**
 * Helpers for cross-reference scanning and name suggestion across
 * the BandMate file types.
 *
 * `.jcp` files reference songs by folder name (`<song_name>` entries)
 * and track maps by filename (`<trackmap>`). Renaming or deleting a
 * song or track map needs to scan + update those references; the
 * helpers here read the .jcp files and return what's affected.
 *
 * Naming: deriving "Foo 2" / "Foo 3" suffixes so Duplicate doesn't
 * collide with existing names.
 */

import { parsePlaylist } from "../codec";
import { readTextFile } from "../fs/workingFolder";
import type { PlaylistSummary } from "../fs/types";

/**
 * Inbound references to a song or track map. Each entry is a
 * playlist that references the target.
 */
export interface PlaylistReference {
  /** Path of the .jcp file. */
  path: string;
  /** Filename of the .jcp (display label). */
  filename: string;
}

/**
 * Find every playlist whose `<song_name>` list contains `songFolderName`.
 * Returns the list in scan order; the `path` field is suitable for a
 * follow-up read/parse/write to remove the reference.
 *
 * Best-effort: a .jcp that fails to parse is silently skipped.
 */
export async function findPlaylistsReferencingSong(
  playlists: PlaylistSummary[],
  songFolderName: string,
): Promise<PlaylistReference[]> {
  const out: PlaylistReference[] = [];
  await Promise.all(
    playlists.map(async (p) => {
      try {
        const text = await readTextFile(p.path);
        const parsed = parsePlaylist(text);
        if (parsed.songNames.includes(songFolderName)) {
          out.push({ path: p.path, filename: p.filename });
        }
      } catch {
        // ignore unreadable / malformed .jcp files
      }
    }),
  );
  // Restore stable order (Promise.all doesn't preserve input order
  // reliably for the resolver writes we made into `out`).
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

/**
 * Find every playlist whose `<trackmap>` filename equals `trackMapFilename`.
 */
export async function findPlaylistsReferencingTrackMap(
  playlists: PlaylistSummary[],
  trackMapFilename: string,
): Promise<PlaylistReference[]> {
  const out: PlaylistReference[] = [];
  await Promise.all(
    playlists.map(async (p) => {
      try {
        const text = await readTextFile(p.path);
        const parsed = parsePlaylist(text);
        if (parsed.trackMap === trackMapFilename) {
          out.push({ path: p.path, filename: p.filename });
        }
      } catch {
        // ignore
      }
    }),
  );
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

/**
 * Suggest an unused `<base> N` name. Tries `base 2`, `base 3`, …
 * until it finds one not in `existing`. Caps at 99 to avoid pathological
 * loops; returns `<base> copy <random>` as a last-resort fallback.
 *
 * `existing` should be the bare names — not filenames with extensions.
 * For songs that's folder names; for playlists / track maps,
 * the filename minus the extension.
 */
export function suggestDuplicateName(
  base: string,
  existing: Set<string>,
): string {
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base} copy ${Math.floor(Math.random() * 10000)}`;
}
