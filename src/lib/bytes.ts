/**
 * Byte-count formatting helper.
 *
 * One shared implementation that handles all four tiers (B / KB / MB
 * / GB) and accepts `null` for callers that pass through "unknown
 * size" placeholders.
 *
 * Tier breakpoints use 1024 (binary), not 1000 (decimal), to match
 * what most file-managers and the existing UI copy assume.
 */

/**
 * Format a byte count as a short human-readable string.
 *
 * - `null` → empty string. Caller is responsible for any "—" / "unknown"
 *   placeholder when an empty string isn't appropriate.
 * - `< 1 KB` → `123 B` (no decimal).
 * - `< 1 MB` → `4.7 KB` (one decimal).
 * - `< 1 GB` → `15.3 MB` (one decimal).
 * - `≥ 1 GB` → `2.41 GB` (two decimals).
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
