import { describe, expect, it } from "vitest";

import {
  _initialStateForTests as initialState,
  _reducerForTests as reducer,
} from "./AppState";

const SAMPLE_SCAN = {
  songs: [
    {
      folderName: "Buffy",
      folderPath: "/foo/Buffy",
      jcsPath: "/foo/Buffy/Buffy.jcs",
    },
  ],
  playlists: [{ filename: "Set.jcp", path: "/foo/Set.jcp" }],
  trackMaps: [{ filename: "tm.jcm", path: "/bar/tm.jcm" }],
};

describe("AppState reducer", () => {
  it("scan_started records the path and flips to loading", () => {
    const next = reducer(initialState, {
      type: "scan_started",
      path: "/Users/eric/bm-stick",
    });
    expect(next.workingFolder).toBe("/Users/eric/bm-stick");
    expect(next.status).toBe("loading");
    expect(next.error).toBeNull();
  });

  it("scan_succeeded fills the scan result and goes ready", () => {
    const loading = reducer(initialState, {
      type: "scan_started",
      path: "/x",
    });
    const ready = reducer(loading, {
      type: "scan_succeeded",
      result: SAMPLE_SCAN,
    });
    expect(ready.status).toBe("ready");
    expect(ready.scan).toEqual(SAMPLE_SCAN);
    expect(ready.workingFolder).toBe("/x");
  });

  it("scan_failed sets the error but keeps the working folder", () => {
    const loading = reducer(initialState, {
      type: "scan_started",
      path: "/y",
    });
    const failed = reducer(loading, {
      type: "scan_failed",
      error: "Cannot read /y/bm_media: permission denied",
    });
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("permission denied");
    // We deliberately keep the workingFolder so the user can retry / fix
    // the underlying issue (e.g. reconnect a USB drive).
    expect(failed.workingFolder).toBe("/y");
  });

  it("clear_working_folder resets to the initial empty state", () => {
    const ready = reducer(
      reducer(initialState, { type: "scan_started", path: "/z" }),
      { type: "scan_succeeded", result: SAMPLE_SCAN },
    );
    const cleared = reducer(ready, { type: "clear_working_folder" });
    expect(cleared).toEqual(initialState);
  });

  it("select_channel sets the channel index", () => {
    const next = reducer(initialState, { type: "select_channel", channel: 5 });
    expect(next.channelSelection).toBe(5);
    const cleared = reducer(next, { type: "select_channel", channel: null });
    expect(cleared.channelSelection).toBeNull();
  });

  it("changing sidebar selection resets the channel selection", () => {
    const withChannel = reducer(initialState, {
      type: "select_channel",
      channel: 3,
    });
    const newSong = reducer(withChannel, {
      type: "select",
      selection: { kind: "song", jcsPath: "/some/song.jcs" },
    });
    expect(newSong.channelSelection).toBeNull();
  });

  it("clear_selection also clears channel selection", () => {
    const withSong = reducer(initialState, {
      type: "select",
      selection: { kind: "song", jcsPath: "/x.jcs" },
    });
    const withChannel = reducer(withSong, {
      type: "select_channel",
      channel: 2,
    });
    const cleared = reducer(withChannel, { type: "clear_selection" });
    expect(cleared.selection).toBeNull();
    expect(cleared.channelSelection).toBeNull();
  });

  it("select_playlist_row sets and clears the row index", () => {
    const next = reducer(initialState, {
      type: "select_playlist_row",
      row: 4,
    });
    expect(next.playlistRowSelection).toBe(4);
    const cleared = reducer(next, {
      type: "select_playlist_row",
      row: null,
    });
    expect(cleared.playlistRowSelection).toBeNull();
  });

  it("changing sidebar selection resets the playlist row selection", () => {
    const withRow = reducer(initialState, {
      type: "select_playlist_row",
      row: 2,
    });
    const newPlaylist = reducer(withRow, {
      type: "select",
      selection: { kind: "playlist", path: "/some/Set.jcp" },
    });
    expect(newPlaylist.playlistRowSelection).toBeNull();
  });
});
