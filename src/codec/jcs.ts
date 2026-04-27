/**
 * `.jcs` song-file codec.
 *
 * On-disk format: XML-ish plain text with 4-space indentation. Stock
 * BM Loader writes UTF-8 with LF line endings and a trailing newline
 * after `</song>`. Schema:
 *
 *   <song>
 *     <srate>...</srate>
 *     <length>...</length>
 *     <file> ... </file>
 *     ... more <file>'s ...
 *     <midi_file> ... </midi_file>   (optional, at most one)
 *   </song>
 *
 * See SPEC.md for full format reference. We use fast-xml-parser for
 * parsing (lenient, well-tested) and hand-roll the writer so output
 * matches stock JoeCo formatting exactly.
 */

import { XMLParser } from "fast-xml-parser";
import type { Song, SongAudioFile, SongMidiFile } from "./types";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  // Treat single-occurrence elements as objects, multi as arrays.
  // We force `file` to always be an array regardless.
  isArray: (name) => name === "file",
  // Don't auto-parse numeric strings — we handle the few numeric fields
  // ourselves so we control type coercion (and can preserve "1.0" precision).
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: true,
  trimValues: true,
});

/**
 * Parse the contents of a `.jcs` file into a `Song`.
 *
 * Throws if the input doesn't have a `<song>` root with the required
 * `<srate>` and `<length>` fields.
 */
export function parseSong(text: string): Song {
  const parsed = parser.parse(text);
  const root = parsed?.song;
  if (!root || typeof root !== "object") {
    throw new Error("Invalid .jcs file: missing <song> root element");
  }

  const sampleRate = parseIntStrict(root.srate, "<srate>");
  const lengthSamples = parseIntStrict(root.length, "<length>");

  const audioFiles: SongAudioFile[] = (root.file ?? []).map(
    (entry: Record<string, string>, idx: number): SongAudioFile => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`<file> entry ${idx}: not an object`);
      }
      return {
        filename: requireString(entry.filename, `<file>[${idx}].filename`),
        channel: parseIntStrict(entry.ch, `<file>[${idx}].ch`),
        level: parseFloatStrict(entry.lvl, `<file>[${idx}].lvl`),
        pan: parseFloatStrict(entry.pan, `<file>[${idx}].pan`),
        mute: parseFloatStrict(entry.mute, `<file>[${idx}].mute`),
      };
    },
  );

  let midiFile: SongMidiFile | undefined;
  if (root.midi_file !== undefined) {
    const m = root.midi_file;
    midiFile = {
      filename: requireString(m.filename, "<midi_file>.filename"),
      channel: parseIntStrict(m.ch, "<midi_file>.ch"),
    };
  }

  return { sampleRate, lengthSamples, audioFiles, midiFile };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Serialize a `Song` to a `.jcs` string.
 *
 * Output format matches stock BM Loader exactly:
 *   - 4-space indentation
 *   - LF line endings, trailing newline after `</song>`
 *   - Element order: `<srate>`, `<length>`, `<file>`'s, `<midi_file>`
 *   - Float values printed with their natural toString (1.0 stays "1.0",
 *     not "1"). We preserve that with `formatFloat`.
 */
export function writeSong(song: Song): string {
  const lines: string[] = [];
  lines.push("<song>");
  lines.push(`    <srate>${song.sampleRate}</srate>`);
  lines.push(`    <length>${song.lengthSamples}</length>`);

  for (const f of song.audioFiles) {
    lines.push("    <file>");
    lines.push(`        <filename>${escapeXml(f.filename)}</filename>`);
    lines.push(`        <ch>${f.channel}</ch>`);
    lines.push(`        <lvl>${formatFloat(f.level)}</lvl>`);
    lines.push(`        <pan>${formatFloat(f.pan)}</pan>`);
    lines.push(`        <mute>${formatFloat(f.mute)}</mute>`);
    lines.push("    </file>");
  }

  if (song.midiFile) {
    lines.push("    <midi_file>");
    lines.push(`        <filename>${escapeXml(song.midiFile.filename)}</filename>`);
    lines.push(`        <ch>${song.midiFile.channel}</ch>`);
    lines.push("    </midi_file>");
  }

  lines.push("</song>");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntStrict(value: unknown, field: string): number {
  if (value === undefined || value === null) {
    throw new Error(`Missing required field ${field}`);
  }
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Field ${field} not an integer: ${JSON.stringify(value)}`);
  }
  return n;
}

function parseFloatStrict(value: unknown, field: string): number {
  if (value === undefined || value === null) {
    throw new Error(`Missing required field ${field}`);
  }
  const n = Number.parseFloat(String(value).trim());
  if (!Number.isFinite(n)) {
    throw new Error(`Field ${field} not a number: ${JSON.stringify(value)}`);
  }
  return n;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required string field ${field}`);
  }
  return value;
}

/**
 * Format a float to match stock BM Loader output: integers gain a `.0`
 * suffix (so `1` becomes `"1.0"`), other values use natural toString.
 * This preserves byte-equivalence with stock files in tests.
 */
function formatFloat(n: number): string {
  if (Number.isInteger(n)) {
    return n.toFixed(1);
  }
  return String(n);
}

/**
 * Minimal XML entity escaping for text content (filenames may contain
 * characters that need escaping in theory, though the BandMate file
 * formats observed in the wild don't — we still defend against it).
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
