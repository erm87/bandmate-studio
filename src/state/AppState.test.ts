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
});
