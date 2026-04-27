import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTrackMap, writeTrackMap } from "./jcm";
import { TRACK_MAP_CHANNEL_COUNT } from "./types";

const FIXTURES = join(__dirname, "__fixtures__");

const fx = (name: string) =>
  readFileSync(join(FIXTURES, name), "utf8");

describe("parseTrackMap", () => {
  it("parses stock JoeCo default_tm.jcm (CRLF, no trailing newline)", () => {
    const map = parseTrackMap(fx("default_tm.jcm"));
    expect(map.channels.length).toBe(TRACK_MAP_CHANNEL_COUNT);
    expect(map.channels[0]).toBe("Click");
    expect(map.channels[1]).toBe("Hihat");
    expect(map.channels[18]).toBe("Lead Vox");
    expect(map.channels[24]).toBe("MIDI");
  });

  it("parses stock JoeCo stems_tm.jcm", () => {
    const map = parseTrackMap(fx("stems_tm.jcm"));
    expect(map.channels.length).toBe(TRACK_MAP_CHANNEL_COUNT);
    // Last channel is conventionally the MIDI label
    expect(map.channels[24]).toBeTruthy();
  });

  it("parses Eric's erictest_tm.jcm (LF, trailing newline, with empty channels)", () => {
    const map = parseTrackMap(fx("erictest_tm.jcm"));
    expect(map.channels.length).toBe(TRACK_MAP_CHANNEL_COUNT);
    expect(map.channels[0]).toBe("Lights");
    expect(map.channels[7]).toBe("Vox");
    // Channels 8..23 are intentionally empty in Eric's setup
    for (let i = 8; i < 24; i++) {
      expect(map.channels[i]).toBe("");
    }
    expect(map.channels[24]).toBe("Kemper");
  });

  it("pads short files to 25 channels", () => {
    const map = parseTrackMap("Click\r\nKick\r\nSnare");
    expect(map.channels.length).toBe(TRACK_MAP_CHANNEL_COUNT);
    expect(map.channels[0]).toBe("Click");
    expect(map.channels[1]).toBe("Kick");
    expect(map.channels[2]).toBe("Snare");
    expect(map.channels[3]).toBe("");
    expect(map.channels[24]).toBe("");
  });

  it("accepts mixed line endings", () => {
    const mixed = "A\r\nB\nC\r\nD";
    const map = parseTrackMap(mixed);
    expect(map.channels.slice(0, 4)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("writeTrackMap", () => {
  it("writes CRLF separators with exactly 25 fields", () => {
    const out = writeTrackMap({
      channels: ["A", "B", "C"].concat(Array(22).fill("")),
    });
    expect(out.startsWith("A\r\nB\r\nC")).toBe(true);
    // Joining 25 entries with CRLF produces exactly 24 CRLFs.
    expect(out.split("\r\n").length).toBe(TRACK_MAP_CHANNEL_COUNT);
    expect((out.match(/\r\n/g) ?? []).length).toBe(TRACK_MAP_CHANNEL_COUNT - 1);
  });

  it("does not append a trailing newline when last channel is non-empty", () => {
    // Mirrors stock JoeCo default_tm.jcm where channel 25 = "MIDI"
    const out = writeTrackMap({
      channels: Array(24).fill("X").concat(["MIDI"]),
    });
    expect(out.endsWith("\r\nMIDI")).toBe(true);
    expect(out.endsWith("\r\n")).toBe(false);
  });

  it("rejects non-25-channel input", () => {
    expect(() => writeTrackMap({ channels: ["only", "two"] })).toThrow();
  });
});

describe("structural round-trip", () => {
  it("default_tm.jcm parses, writes, reparses to the same TrackMap", () => {
    const original = parseTrackMap(fx("default_tm.jcm"));
    const written = writeTrackMap(original);
    const reparsed = parseTrackMap(written);
    expect(reparsed).toEqual(original);
  });

  it("stems_tm.jcm round-trips structurally", () => {
    const original = parseTrackMap(fx("stems_tm.jcm"));
    const reparsed = parseTrackMap(writeTrackMap(original));
    expect(reparsed).toEqual(original);
  });

  it("erictest_tm.jcm round-trips structurally (LF input → CRLF output)", () => {
    const original = parseTrackMap(fx("erictest_tm.jcm"));
    const reparsed = parseTrackMap(writeTrackMap(original));
    expect(reparsed).toEqual(original);
  });

  it("byte-identical round-trip for stock files (CRLF, no trailing newline)", () => {
    const raw = fx("default_tm.jcm");
    const written = writeTrackMap(parseTrackMap(raw));
    expect(written).toBe(raw);
  });
});
