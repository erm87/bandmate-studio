/**
 * Pre-export validation helpers.
 *
 * Cheap checks only — runs from the export confirm step before the
 * copy starts. Reads every `.jcp` once and cross-references against
 * the working-folder scan.
 *
 * Warnings surface in the confirm dialog; the user can still proceed
 * (BandMate hardware tolerates broken references — it just skips
 * songs it can't find).
 *
 * Future: stereo-WAV scan + drive-size check (both require more I/O).
 * Not blocking for v0.1.
 */

import { parsePlaylist } from "../codec";
import { readTextFile } from "../fs/workingFolder";
import type { ScanResult } from "../fs/types";

/** A finding from `runPreExportValidation`. */
export interface ExportFinding {
  /** Severity. v0.1 only emits warnings; we'll add "error" later for
   *  blocking conditions like "drive doesn't fit." */
  severity: "warning";
  /** One-line summary shown in the dialog. */
  message: string;
  /** Optional second line with detail (e.g., the affected filename). */
  detail?: string;
}

/**
 * Run validation against the in-memory `ScanResult` and the on-disk
 * `.jcp` files. Returns a list of findings — empty list means no
 * issues, the user can proceed.
 *
 * The scan provides:
 *   - songs[]: folder names that exist under bm_sources/
 *   - playlists[]: every .jcp file
 *   - trackMaps[]: every .jcm file
 *
 * For each .jcp we check that:
 *   - Every <song_name> has a matching song folder.
 *   - The <trackmap> field has a matching .jcm file.
 *
 * Sample-rate consistency is already flagged inside the playlist
 * editor (Phase 4.8) and is non-blocking on the BandMate, so we don't
 * surface it again at export time. (May reconsider if Eric wants it.)
 */
export async function runPreExportValidation(
  scan: ScanResult,
): Promise<ExportFinding[]> {
  const findings: ExportFinding[] = [];

  const songFolders = new Set(scan.songs.map((s) => s.folderName));
  const trackMapFilenames = new Set(scan.trackMaps.map((t) => t.filename));

  // Read every playlist and check its references. Run in parallel —
  // they're small and independent.
  const playlistChecks = await Promise.all(
    scan.playlists.map(async (p) => {
      try {
        const text = await readTextFile(p.path);
        const playlist = parsePlaylist(text);
        const out: ExportFinding[] = [];
        // Missing song references.
        const missingSongs = playlist.songNames.filter(
          (name) => !songFolders.has(name),
        );
        if (missingSongs.length > 0) {
          out.push({
            severity: "warning",
            message: `${p.filename}: ${missingSongs.length} missing song ${
              missingSongs.length === 1 ? "reference" : "references"
            }`,
            detail: missingSongs.join(", "),
          });
        }
        // Missing track map.
        if (
          playlist.trackMap &&
          !trackMapFilenames.has(playlist.trackMap)
        ) {
          out.push({
            severity: "warning",
            message: `${p.filename}: track map "${playlist.trackMap}" not found`,
          });
        }
        return out;
      } catch (e) {
        return [
          {
            severity: "warning" as const,
            message: `${p.filename}: failed to parse`,
            detail: e instanceof Error ? e.message : String(e),
          },
        ];
      }
    }),
  );
  for (const list of playlistChecks) {
    findings.push(...list);
  }

  return findings;
}
