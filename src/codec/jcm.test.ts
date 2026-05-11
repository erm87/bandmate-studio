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
  // Modern BM Loader (audited 2026-05-11) writes LF separators with
  // a trailing newline. Our writer matches that convention. The
  // bundled stock fixtures (default_tm.jcm, stems_tm.jcm) use the
  // older CRLF-without-trailing-newline convention — they're tested
  // for PARSE compatibility below, not byte-equality on write.
  it("writes LF separators with exactly 25 fields and a trailing newline", () => {
    const out = writeTrackMap({
      channels: ["A", "B", "C"].concat(Array(22).fill("")),
    });
    expect(out.startsWith("A\nB\nC")).toBe(true);
    // 25 channels joined by LF + trailing newline = 25 LFs total.
    expect((out.match(/\n/g) ?? []).length).toBe(TRACK_MAP_CHANNEL_COUNT);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("appends a trailing newline even when last channel is non-empty", () => {
    const out = writeTrackMap({
      channels: Array(24).fill("X").concat(["MIDI"]),
    });
    expect(out.endsWith("MIDI\n")).toBe(true);
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

  // Note: there's no "byte-identical round-trip for stock fixtures"
  // test anymore. Our writer (LF + trailing newline) does NOT produce
  // the same bytes as the bundled stock fixtures (CRLF, no trailing
  // newline) — by design. Structural round-trip above still proves
  // semantic preservation. Byte-equality against modern BM Loader
  // user-created trackmaps is exercised by the smoke-test diff (see
  // docs/SMOKE-TEST.md §8).
});
