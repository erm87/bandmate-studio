/**
 * Parse the project's `CHANGELOG.md` into structured entries for
 * display in the app's About section.
 *
 * The source file follows [Keep a Changelog](https://keepachangelog.com/),
 * a regular subset of markdown:
 *
 *     ## [0.2.0] — 2026-05-13
 *
 *     Optional description paragraph(s).
 *
 *     ### Added
 *
 *     - Item one.
 *     - Item two with `code` and **bold** and [a link](https://...).
 *
 *     ### Changed
 *
 *     - Item three.
 *
 * The parser is intentionally narrow — it doesn't pretend to handle
 * arbitrary markdown. We control the source file, so a small,
 * predictable parser beats pulling in a full markdown library for
 * the ~5 inline-formatting features actually used.
 */

export interface ChangelogEntry {
  /** "0.2.0" or "Unreleased" — without the surrounding brackets. */
  version: string;
  /** "2026-05-13" or null for the Unreleased section. */
  date: string | null;
  /** Paragraphs of free text between the version header and the first `### Category`. */
  description: string[];
  /** Categories like "Added", "Changed", each with their bullets in source order. */
  categories: ChangelogCategory[];
}

export interface ChangelogCategory {
  /** "Added" / "Changed" / "Fixed" / "Removed" / etc. — whatever the source uses. */
  name: string;
  /** Bullet items, in source order. Sub-sub-headings inside a category are flattened into preceding bullets' context. */
  items: ChangelogItem[];
}

export type ChangelogItem =
  | { kind: "bullet"; text: string }
  /** A `#### Sub-section` inside a category (CHANGELOG.md uses these to group bullets within e.g. "Added"). */
  | { kind: "subheading"; text: string };

/**
 * Parse a raw CHANGELOG.md string. Returns entries in source order
 * (newest first, matching the file convention). Skips the file's
 * top header + intro paragraphs.
 */
export function parseChangelog(source: string): ChangelogEntry[] {
  const lines = source.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentCategory: ChangelogCategory | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    // `## [version] — date` or `## [version]` — opens a new entry.
    const versionMatch = /^##\s+\[([^\]]+)\](?:\s*[—-]\s*(.+))?$/.exec(line);
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        date: versionMatch[2]?.trim() || null,
        description: [],
        categories: [],
      };
      currentCategory = null;
      continue;
    }
    if (!current) {
      // Pre-first-version preamble — file title, intro paragraphs.
      // Skip entirely.
      continue;
    }
    // `### Category` — opens a new category within the current entry.
    const categoryMatch = /^###\s+(.+)$/.exec(line);
    if (categoryMatch) {
      currentCategory = { name: categoryMatch[1].trim(), items: [] };
      current.categories.push(currentCategory);
      continue;
    }
    // `#### Subheading` — a heading inside a category. Renders as
    // a smaller heading above the next batch of bullets.
    const subheadingMatch = /^####\s+(.+)$/.exec(line);
    if (subheadingMatch && currentCategory) {
      currentCategory.items.push({
        kind: "subheading",
        text: subheadingMatch[1].trim(),
      });
      continue;
    }
    // `- item` — bullet. Belongs to the current category if any;
    // we silently drop bullets that appear before a category (they
    // shouldn't, in a well-formed file).
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (bulletMatch && currentCategory) {
      currentCategory.items.push({
        kind: "bullet",
        text: bulletMatch[1].trim(),
      });
      continue;
    }
    // Any other non-blank text before the first `###` is part of
    // the entry's description.
    if (line.length > 0 && !currentCategory) {
      current.description.push(line);
    }
    // Blank lines and out-of-place content are ignored.
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Inline markdown segment — produced by `parseInline`. Consumed by
 * the React renderer in SettingsDialog so we can output the right
 * element type per segment without doing any DOM-level innerHTML.
 */
export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/**
 * Parse a single line of markdown into typed segments. Handles
 * `**bold**`, `` `code` ``, and `[text](url)`. Anything else is
 * plain text. Regex-based — fine for the small content set, but
 * doesn't handle nesting (e.g., `**bold with `code` inside**` —
 * the outer bold wins, inner code is treated as literal).
 */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Combined alternation: bold | code | link. Order matters —
  // `**` must be tested before `*` (we don't support `*italic*`
  // today but the bold delimiter is `**`); code is single-tick.
  const regex = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        text: text.slice(lastIndex, match.index),
      });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "bold", text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "code", text: match[2] });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      segments.push({ kind: "link", text: match[3], href: match[4] });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
