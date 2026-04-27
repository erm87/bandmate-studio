import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSong, writeSong } from "./jcs";

const FIXTURES = join(__dirname, "__fixtures__");
const fx = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseSong", () => {
  it("parses Buffy.jcs (audio + MIDI)", () => {
    const song = parseSong(fx("Buffy.jcs"));
    expect(song.sampleRate).toBe(48000);
    expect(song.lengthSamples).toBe(9699328);
    expect(song.audioFiles.length).toBeGreaterThan(0);
    expect(song.audioFiles[0]).toMatchObject({
      filename: "Time Code_buffy.wav",
      channel: 0,
      level: 1.0,
      pan: 0.5,
      mute: 1.0,
    });
    expect(song.midiFile).toBeDefined();
    expect(song.midiFile!.filename).toBe("kemper_buffy v3.mid");
    expect(song.midiFile!.channel).toBe(24);
  });

  it("parses Strange.jcs (audio + MIDI)", () => {
    const song = parseSong(fx("Strange.jcs"));
    expect(song.sampleRate).toBe(48000);
    expect(song.audioFiles.length).toBeGreaterThan(0);
    expect(song.midiFile).toBeDefined();
    expect(song.midiFile!.filename).toBe("kemper_strange v2.mid");
    expect(song.midiFile!.channel).toBe(24);
  });

  it("rejects missing <song> root", () => {
    expect(() => parseSong("<not_a_song></not_a_song>")).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => parseSong("<song></song>")).toThrow();
  });
});

describe("writeSong", () => {
  it("emits stock JoeCo formatting (4-space indent, LF, trailing newline)", () => {
    const out = writeSong({
      sampleRate: 48000,
      lengthSamples: 100,
      audioFiles: [
        {
          filename: "test.wav",
          channel: 0,
          level: 1.0,
          pan: 0.5,
          mute: 1.0,
        },
      ],
    });
    expect(out).toContain("<song>\n");
    expect(out).toContain("    <srate>48000</srate>\n");
    expect(out).toContain("        <filename>test.wav</filename>\n");
    expect(out.endsWith("</song>\n")).toBe(true);
    // Float precision preservation: 1.0 stays as "1.0", not "1"
    expect(out).toContain("<lvl>1.0</lvl>");
    expect(out).toContain("<pan>0.5</pan>");
  });

  it("includes <midi_file> after <file> entries when set", () => {
    const out = writeSong({
      sampleRate: 48000,
      lengthSamples: 100,
      audioFiles: [
        {
          filename: "a.wav",
          channel: 0,
          level: 1.0,
          pan: 0.5,
          mute: 1.0,
        },
      ],
      midiFile: { filename: "song.mid", channel: 24 },
    });
    const fileIdx = out.indexOf("</file>");
    const midiIdx = out.indexOf("<midi_file>");
    expect(fileIdx).toBeGreaterThan(-1);
    expect(midiIdx).toBeGreaterThan(fileIdx);
  });
});

describe("structural round-trip", () => {
  it("Buffy.jcs round-trips structurally", () => {
    const original = parseSong(fx("Buffy.jcs"));
    const reparsed = parseSong(writeSong(original));
    expect(reparsed).toEqual(original);
  });

  it("Strange.jcs (with MIDI) round-trips structurally", () => {
    const original = parseSong(fx("Strange.jcs"));
    const reparsed = parseSong(writeSong(original));
    expect(reparsed).toEqual(original);
  });

  it("Buffy.jcs round-trips byte-identically", () => {
    const raw = fx("Buffy.jcs");
    const written = writeSong(parseSong(raw));
    expect(written).toBe(raw);
  });

  it("Strange.jcs round-trips byte-identically", () => {
    const raw = fx("Strange.jcs");
    const written = writeSong(parseSong(raw));
    expect(written).toBe(raw);
  });
});
