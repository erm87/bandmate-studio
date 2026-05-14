/**
 * Duration formatting helper.
 *
 * One shared implementation, used by the song-editor channel grid
 * (per-channel duration in `m:ss`) and the playlist-header roll-up
 * (total runtime that may exceed 1 hour, so `h:mm:ss` when needed).
 */

/**
 * Format a total-seconds value as `m:ss` (or `h:mm:ss` if ≥1 hour).
 *
 * Always rounds down (`Math.floor`) and clamps negatives to 0, so a
 * value of `-0.4` renders as `0:00` rather than `-1:60`. Minutes are
 * unpadded; seconds are zero-padded to two digits; hours, when shown,
 * are unpadded and minutes get zero-padded to two digits.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 3600) {
    const mm = Math.floor(seconds / 60);
    const ss = (seconds % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
