/**
 * Token-based fuzzy matching for the "Import all" flow.
 *
 * Splits filenames and channel labels into normalized word tokens,
 * then scores how strongly a given label applies to a given filename.
 * Lets a label like "Click" match a filename like
 * "ClickCues_chinda-doll_v3 cues added.wav" without requiring the user
 * to keep filenames and labels in lockstep.
 *
 * Phase 1 scoring uses the channel label alone. Phase 2 (keywords
 * column in the TrackMap editor) will extend `scoreFilenameAgainst`
 * to also accept a per-channel keywords list and OR them into the
 * match; the public shape here is designed to make that addition
 * non-breaking.
 */

/**
 * Split a string into lowercased word tokens. Handles audio-naming
 * conventions in the wild: camelCase, snake_case, kebab-case, spaces,
 * dots, AND letter↔digit transitions (so "Subs808s" splits into
 * `[subs, 808, s]` and a label like "808s" → `[808, s]` matches it).
 *
 * Examples:
 *   "ClickCues_chinda-doll_v3 cues added"
 *     → ["click", "cues", "chinda", "doll", "v", "3", "cues", "added"]
 *
 *   "Guitars_china-doll-v2-gained"
 *     → ["guitars", "china", "doll", "v", "2", "gained"]
 *
 *   "Subs808s_china-doll-v2"
 *     → ["subs", "808", "s", "china", "doll", "v", "2"]
 *
 *   "MasterKick_v1" → ["master", "kick", "v", "1"]
 *
 *   "Bassmix" → ["bassmix"]
 *     (no boundary inside the word; the scoring path falls back to
 *      a prefix check so "Bass" still matches "Bassmix" with lower
 *      confidence)
 *
 * Trade-off note: letter↔digit splitting can produce 1-char tokens
 * like "s" or "v" from things like "808s" / "v2". Single-char label
 * tokens that happen to match in a filename will count for the
 * exact-match score, which is mostly fine but could over-fire if a
 * user actually labels a channel just "v" or "s" (vanishingly rare
 * in practice). The prefix-match path gates on `lt.length >= 3` to
 * avoid the more aggressive variant of this problem.
 */
export function tokenize(s: string): string[] {
  return s
    // camelCase / kebabCase boundary: lowercase-or-digit → Uppercase.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // Acronym → camelCase boundary: ABCdef → ABC def.
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // Letter → digit boundary: "Subs808" → "Subs 808", "Mic1" → "Mic 1".
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    // Digit → letter boundary: "808s" → "808 s", "8Bit" → "8 Bit".
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    // Split on anything non-alphanumeric.
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Strip the audio / MIDI extension from a filename before tokenizing.
 * Keeps "wav" / "mid" from polluting the token set.
 */
function stripAudioExt(filename: string): string {
  return filename.replace(/\.(wav|mid)$/i, "");
}

/**
 * Score how strongly `label` applies to `filename`, in the range [0, 1].
 *
 * Per label token:
 *   - 2 points for an exact match against any filename token.
 *   - 1 point for a prefix match (label token is at least 3 chars
 *     and prefixes some filename token — e.g., "bass" → "bassmix").
 *   - 0 otherwise.
 *
 * Total is normalized by `(labelTokenCount * 2)` so scores compare
 * fairly between labels of different lengths.
 *
 * A score of 0 means "no signal" — callers should treat the file as
 * unmatched and direct-copy it into the song folder rather than
 * assigning it to a channel.
 */
export function scoreFilenameAgainstLabel(
  filename: string,
  label: string,
): number {
  const labelTokens = tokenize(label);
  if (labelTokens.length === 0) return 0;
  const filenameTokens = new Set(tokenize(stripAudioExt(filename)));
  if (filenameTokens.size === 0) return 0;

  let points = 0;
  for (const lt of labelTokens) {
    if (filenameTokens.has(lt)) {
      points += 2;
      continue;
    }
    // Prefix fallback. We gate on `lt.length >= 3` so 1-2 char label
    // tokens don't sweep up unrelated filenames (e.g. "k" should not
    // match every filename starting with k).
    if (lt.length >= 3) {
      for (const ft of filenameTokens) {
        if (ft.startsWith(lt)) {
          points += 1;
          break;
        }
      }
    }
  }
  return points / (labelTokens.length * 2);
}

/**
 * One channel index along with the score it earned for the filename
 * being matched. Returned by `bestChannelForFilename` to drive the
 * import-all assignment decision.
 */
export interface ChannelMatch {
  channel: number;
  score: number;
}

/**
 * Find the best-matching labeled channel for a filename across a
 * track-map's label array.
 *
 * `channelLabels` is the full label list (25 entries today: 24 audio
 * + 1 MIDI slot). Unlabeled channels (empty strings) are skipped.
 * `skipChannels` lets the caller exclude the MIDI slot — the
 * import-all flow handles MIDI separately by file kind.
 *
 * Tiebreakers when multiple labels score equally:
 *   1. More-specific label wins (more tokens — "Master Kick" beats
 *      "Kick" against "MasterKick_v1").
 *   2. Lowest channel index wins (deterministic; first-declared
 *      channel claims the file).
 *
 * Returns null when no label scores above zero — the caller should
 * direct-copy instead of assigning to a channel.
 */
export function bestChannelForFilename(
  filename: string,
  channelLabels: readonly string[],
  skipChannels: ReadonlySet<number> = new Set(),
): ChannelMatch | null {
  let best: ChannelMatch | null = null;
  let bestLabelTokenCount = 0;
  for (let ch = 0; ch < channelLabels.length; ch++) {
    if (skipChannels.has(ch)) continue;
    const label = channelLabels[ch];
    if (!label || label.length === 0) continue;
    const score = scoreFilenameAgainstLabel(filename, label);
    if (score <= 0) continue;
    const tokenCount = tokenize(label).length;
    const better =
      best === null ||
      score > best.score ||
      (score === best.score && tokenCount > bestLabelTokenCount);
    if (better) {
      best = { channel: ch, score };
      bestLabelTokenCount = tokenCount;
    }
  }
  return best;
}
