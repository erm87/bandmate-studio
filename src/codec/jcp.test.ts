import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePlaylist, writePlaylist } from "./jcp";

const FIXTURES = join(__dirname, "__fixtures__");
const fx = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parsePlaylist", () => {
  it("parses May v3.jcp", () => {
    const p = parsePlaylist(fx("May v3.jcp"));
    expect(p.displayName).toBe("May v3");
    expect(p.sampleRate).toBe(48000);
    expect(p.trackMap).toBe("erictest_tm.jcm");
    expect(p.songNames.length).toBe(11);
    expect(p.songNames[0]).toBe("Tie Her Down (no intro)");
    expect(p.songNames[p.songNames.length - 1]).toBe("Rabid");
  });

  it("parses Simpler Playlist.jcp (small fixture)", () => {
    const p = parsePlaylist(fx("Simpler Playlist.jcp"));
    expect(p.displayName).toBeTruthy();
    expect(p.sampleRate).toBeGreaterThan(0);
    expect(p.songNames.length).toBeGreaterThan(0);
  });

  it("rejects missing <playlist> root", () => {
    expect(() => parsePlaylist("<x></x>")).toThrow();
  });
});

describe("writePlaylist", () => {
  it("emits stock JoeCo formatting", () => {
    const out = writePlaylist({
      displayName: "Test",
      sampleRate: 48000,
      trackMap: "default_tm.jcm",
      songNames: ["Song A", "Song B"],
    });
    expect(out).toContain("<playlist>\n");
    expect(out).toContain(
      "    <playlist_display_name>Test</playlist_display_name>\n",
    );
    expect(out).toContain("    <song_name>Song A</song_name>\n");
    expect(out.endsWith("</playlist>\n")).toBe(true);
  });

  it("preserves song order", () => {
    const songs = ["Z", "A", "M", "B"];
    const out = writePlaylist({
      displayName: "Order Test",
      sampleRate: 48000,
      trackMap: "x.jcm",
      songNames: songs,
    });
    const indexes = songs.map((s) => out.indexOf(`<song_name>${s}</song_name>`));
    // Each subsequent index should be greater than the previous
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  });
});

describe("structural round-trip", () => {
  it("May v3.jcp round-trips structurally", () => {
    const original = parsePlaylist(fx("May v3.jcp"));
    const reparsed = parsePlaylist(writePlaylist(original));
    expect(reparsed).toEqual(original);
  });

  it("Simpler Playlist.jcp round-trips structurally", () => {
    const original = parsePlaylist(fx("Simpler Playlist.jcp"));
    const reparsed = parsePlaylist(writePlaylist(original));
    expect(reparsed).toEqual(original);
  });

  it("May v3.jcp round-trips byte-identically", () => {
    const raw = fx("May v3.jcp");
    const written = writePlaylist(parsePlaylist(raw));
    expect(written).toBe(raw);
  });
});
