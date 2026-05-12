/**
 * Left sidebar with three sections: Songs, Playlists, Track Maps.
 *
 * Phase 3a: rows are clickable; clicking dispatches `select`.
 * Phase 4.9–4.11: right-clicking a row opens a context menu with
 *   Rename / Duplicate / Delete actions.
 *
 * Cross-reference handling:
 *   - Deleting a song that's used in playlists → confirm dialog lists
 *     the affected playlists; on confirm we remove the references
 *     before deleting the song.
 *   - Deleting a track map that's used in playlists → confirm dialog
 *     warns the user (we don't auto-cascade because there's no sane
 *     replacement, unlike removing a song from a playlist's list).
 *   - Rename is wired in Phase 4.12 — it'll re-use the same machinery
 *     to update inbound references.
 */

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  parsePlaylist,
  writePlaylist,
} from "../codec";
import {
  deletePlaylist,
  deleteSong,
  deleteTrackMap,
  duplicatePlaylist,
  duplicateSong,
  duplicateTrackMap,
  importTrackMap,
  readTextFile,
  renamePlaylist,
  renameSong,
  renameTrackMap,
  revealInFileManager,
  writeTextFile,
  type RemoteTrackMap,
} from "../fs/workingFolder";
import {
  findPlaylistsReferencingSong,
  findPlaylistsReferencingTrackMap,
  suggestDuplicateName,
} from "../lib/references";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import { ContextMenu, type OpenContextMenu } from "./ContextMenu";
import { NewSongDialog } from "./NewSongDialog";
import { NewPlaylistDialog } from "./NewPlaylistDialog";
import { NewTrackMapDialog } from "./NewTrackMapDialog";
import { ImportTrackMapDialog } from "./ImportTrackMapDialog";
import { RenameDialog } from "./RenameDialog";
import type {
  PlaylistSummary,
  SongSummary,
  TrackMapSummary,
} from "../fs/types";

/**
 * Active rename dialog target. The sidebar pre-loads the cross-ref
 * preview before opening the dialog so the user sees the impact
 * immediately rather than seeing a blank dialog flicker into a
 * preview line a moment later.
 */
type RenameTarget =
  | {
      kind: "song";
      target: SongSummary;
      preview: string;
      existingNames: Set<string>;
    }
  | {
      kind: "playlist";
      target: PlaylistSummary;
      preview: string;
      existingNames: Set<string>;
    }
  | {
      kind: "trackMap";
      target: TrackMapSummary;
      preview: string;
      existingNames: Set<string>;
    };

export function Sidebar() {
  const {
    state,
    dispatch,
    rescan,
    requestSelect,
    requestClearSelection,
  } = useAppState();
  const { songs, playlists, trackMaps } = state.scan;
  const sel = state.selection;
  const [newSongOpen, setNewSongOpen] = useState(false);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newTrackMapOpen, setNewTrackMapOpen] = useState(false);
  const [importTrackMapOpen, setImportTrackMapOpen] = useState(false);
  /**
   * When set, ImportTrackMapDialog opens pre-populated with these files
   * (no folder-pick step). Set by the drag-drop handler.
   */
  const [importPrepopulated, setImportPrepopulated] = useState<
    RemoteTrackMap[] | null
  >(null);
  /**
   * Visual highlight on the Track Maps section while files are being
   * dragged over it. Toggled by the Tauri drag-drop event listener.
   */
  const [isDragOver, setIsDragOver] = useState(false);
  const trackMapsSectionRef = useRef<HTMLDetailsElement | null>(null);
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  /**
   * Active rename dialog. Carries the target item plus a pre-loaded
   * cross-reference preview so the dialog opens already populated.
   */
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  // ---- Drag-drop: import .jcm into Track Maps section -------------------
  //
  // With tauri.conf.json's `dragDropEnabled: true`, Tauri sends webview
  // drag/drop events instead of letting the browser handle them. We
  // subscribe at mount and hit-test the drop position against the Track
  // Maps section's bounding rect.
  //
  // Two structural requirements that bit earlier versions of this code:
  //
  // 1. The listener must always see the LATEST `state.workingFolder` /
  //    `trackMaps` / `rescan` / `dispatch` — not stale closure captures
  //    from the render where the listener was first registered.
  //    Otherwise a delete-then-redrop cycle leaves the listener calling
  //    a stale handler that thinks the deleted file still exists.
  //    Solution: keep the listener registered ONCE (empty deps) and
  //    have it call `dropHandlerRef.current(paths)`, where the ref is
  //    re-pointed at the latest handler on every render.
  //
  // 2. 'over' events have no `paths` field (only 'enter' and 'drop' do).
  //    Treating `paths.length > 0` as the eligibility predicate on
  //    every event causes the drop indicator to flicker off on every
  //    'over' tick. Solution: latch eligibility on 'enter', clear on
  //    'leave' or 'drop'.
  //
  // Coordinate note: Tauri v2 reports positions in *physical* pixels;
  // divide by devicePixelRatio to compare against getBoundingClientRect
  // (CSS pixels).
  //
  // Single .jcm with no name collision → import directly (fast path).
  // Multiple files OR any collision → open the import dialog with the
  // dropped files pre-populated, so the user can resolve and confirm.

  /**
   * Always-current drop handler. Re-pointed every render so the
   * mounted-once event listener invokes the latest closure (and so
   * picks up the latest `trackMaps` / `state.workingFolder` after a
   * delete + rescan).
   */
  const dropHandlerRef = useRef<(paths: string[]) => void>(() => {});
  dropHandlerRef.current = (paths: string[]) => {
    if (!state.workingFolder) return;
    void (async () => {
      setRowError(null);

      // Build RemoteTrackMap entries for each dropped file. We don't
      // have size/mtime cheaply on the TS side, so we synthesize a
      // minimal shape — the dialog renders fine with sizeBytes=0 /
      // null mtime (those fields format as "0 B" / "" respectively).
      // The dialog itself doesn't depend on accurate stats for
      // collision resolution.
      const dropped: RemoteTrackMap[] = paths.map((p) => {
        const filename = p.split(/[\\/]/).pop()?.trim() ?? p;
        return {
          filename,
          path: p,
          sizeBytes: 0,
          modifiedSeconds: null,
        };
      });

      const existingLowercased = new Set(
        trackMaps.map((tm) => tm.filename.toLowerCase()),
      );
      const anyCollides = dropped.some((d) =>
        existingLowercased.has(d.filename.toLowerCase()),
      );

      // Fast path: one file, no collision → import inline.
      if (dropped.length === 1 && !anyCollides) {
        try {
          const newPath = await importTrackMap(
            dropped[0].path,
            state.workingFolder!,
            dropped[0].filename,
            false,
          );
          await rescan();
          dispatch({
            type: "select",
            selection: { kind: "trackMap", path: newPath },
          });
        } catch (e) {
          setRowError(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      // Slow path: open the dialog pre-populated so the user can
      // resolve collisions / confirm.
      setImportPrepopulated(dropped);
      setImportTrackMapOpen(true);
    })();
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    // Latched on 'enter' when the drag carries at least one .jcm.
    // Cleared on 'leave' or 'drop'. The drop-zone highlight uses
    // (eligible && inside) so continuous 'over' events (which carry
    // no paths field in Tauri v2) don't flicker the indicator off.
    let eligible = false;

    void (async () => {
      const webview = getCurrentWebview();
      const offFn = await webview.onDragDropEvent((event) => {
        const paths =
          "paths" in event.payload
            ? event.payload.paths.filter((p) =>
                p.toLowerCase().endsWith(".jcm"),
              )
            : [];

        // No position-based hit-test. Tauri v2 on macOS reports
        // drag-drop coordinates in a system that doesn't line up
        // cleanly with `getBoundingClientRect()` — we tested it: the
        // reported position is consistently in the upper-left of the
        // window regardless of where the cursor actually is. Since
        // `.jcm` files only ever go to the Track Maps section, we
        // accept a drop anywhere in the window and always route it
        // there; the visible overlay on the section tells the user
        // where the file is headed.
        if (event.payload.type === "enter") {
          eligible = paths.length > 0;
          setIsDragOver(eligible);
          return;
        }
        if (event.payload.type === "over") {
          setIsDragOver(eligible);
          return;
        }
        if (event.payload.type === "leave") {
          eligible = false;
          setIsDragOver(false);
          return;
        }
        if (event.payload.type === "drop") {
          const wasEligible = eligible;
          setIsDragOver(false);
          eligible = false;
          if (!wasEligible || paths.length === 0) return;
          dropHandlerRef.current(paths);
        }
      });
      if (cancelled) offFn();
      else unlisten = offFn;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
    // Listener registered once on mount; pulls state via
    // dropHandlerRef.current. Re-registering on every state change
    // caused the prior bug where the second drop silently used a
    // stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (
    selection:
      | { kind: "song"; jcsPath: string }
      | { kind: "playlist"; path: string }
      | { kind: "trackMap"; path: string },
    isActive: boolean,
  ) => {
    // Both branches go through the request* helpers so the
    // unsaved-changes guard can intercept if the current editor is
    // dirty.
    if (isActive) {
      void requestClearSelection();
    } else {
      void requestSelect(selection);
    }
  };

  // ---- Song operations ----------------------------------------------------

  const handleDeleteSong = async (song: SongSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const refs = await findPlaylistsReferencingSong(playlists, song.folderName);
      const refList =
        refs.length > 0
          ? `\n\nUsed in ${refs.length} ${refs.length === 1 ? "playlist" : "playlists"}:\n` +
            refs.map((r) => `  • ${r.filename}`).join("\n") +
            `\n\nThe song will be removed from ${refs.length === 1 ? "this playlist" : "these playlists"} too.`
          : "";
      const confirmed = await ask(
        `Delete "${song.folderName}"?${refList}\n\nThis cannot be undone — the song folder and all its WAVs will be removed.`,
        {
          title: "Delete Song",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
      if (!confirmed) return;
      // 1. Strip the song from each referencing playlist.
      for (const ref of refs) {
        const text = await readTextFile(ref.path);
        const playlist = parsePlaylist(text);
        playlist.songNames = playlist.songNames.filter(
          (n) => n !== song.folderName,
        );
        await writeTextFile(ref.path, writePlaylist(playlist));
      }
      // 2. Delete the song folder.
      await deleteSong(state.workingFolder, song.folderPath);
      // 3. Clear selection if the deleted song was open.
      if (sel?.kind === "song" && sel.jcsPath === song.jcsPath) {
        dispatch({ type: "clear_selection" });
      }
      await rescan();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDuplicateSong = async (song: SongSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const existing = new Set(songs.map((s) => s.folderName));
      const newName = suggestDuplicateName(song.folderName, existing);
      const created = await duplicateSong(
        state.workingFolder,
        song.folderName,
        newName,
      );
      await rescan();
      dispatch({
        type: "select",
        selection: { kind: "song", jcsPath: created.jcsPath },
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Playlist operations ------------------------------------------------

  const handleDeletePlaylist = async (playlist: PlaylistSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const confirmed = await ask(
        `Delete "${playlist.filename}"?\n\nThis cannot be undone — the .jcp file will be removed. The songs it referenced are not affected.`,
        {
          title: "Delete Playlist",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
      if (!confirmed) return;
      await deletePlaylist(state.workingFolder, playlist.path);
      if (sel?.kind === "playlist" && sel.path === playlist.path) {
        dispatch({ type: "clear_selection" });
      }
      await rescan();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDuplicatePlaylist = async (playlist: PlaylistSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const base = playlist.filename.replace(/\.jcp$/i, "");
      const existingBases = new Set(
        playlists.map((p) => p.filename.replace(/\.jcp$/i, "")),
      );
      const newName = suggestDuplicateName(base, existingBases);
      const created = await duplicatePlaylist(
        state.workingFolder,
        playlist.path,
        newName,
      );
      await rescan();
      dispatch({
        type: "select",
        selection: { kind: "playlist", path: created.jcpPath },
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Track map operations -----------------------------------------------

  const handleDeleteTrackMap = async (trackMap: TrackMapSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const refs = await findPlaylistsReferencingTrackMap(
        playlists,
        trackMap.filename,
      );
      const refList =
        refs.length > 0
          ? `\n\nUsed in ${refs.length} ${refs.length === 1 ? "playlist" : "playlists"}:\n` +
            refs.map((r) => `  • ${r.filename}`).join("\n") +
            `\n\nThose ${refs.length === 1 ? "playlist" : "playlists"} will reference a missing track map until you pick a new one.`
          : "";
      const confirmed = await ask(
        `Delete "${trackMap.filename}"?${refList}\n\nThis cannot be undone.`,
        {
          title: "Delete Track Map",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
      if (!confirmed) return;
      await deleteTrackMap(state.workingFolder, trackMap.path);
      if (sel?.kind === "trackMap" && sel.path === trackMap.path) {
        dispatch({ type: "clear_selection" });
      }
      await rescan();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDuplicateTrackMap = async (trackMap: TrackMapSummary) => {
    if (!state.workingFolder) return;
    setRowError(null);
    try {
      const base = trackMap.filename.replace(/\.jcm$/i, "");
      const existingBases = new Set(
        trackMaps.map((t) => t.filename.replace(/\.jcm$/i, "")),
      );
      const newName = suggestDuplicateName(base, existingBases);
      const newPath = await duplicateTrackMap(
        state.workingFolder,
        trackMap.path,
        newName,
      );
      await rescan();
      dispatch({
        type: "select",
        selection: { kind: "trackMap", path: newPath },
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Rename: open dialog after pre-loading cross-ref preview -----------

  const openRenameSong = async (song: SongSummary) => {
    setRowError(null);
    try {
      const refs = await findPlaylistsReferencingSong(playlists, song.folderName);
      const preview =
        refs.length === 0
          ? ""
          : `This will also update ${refs.length} ${refs.length === 1 ? "reference" : "references"} in: ${refs.map((r) => r.filename).join(", ")}.`;
      setRenameTarget({
        kind: "song",
        target: song,
        preview,
        existingNames: new Set(songs.map((s) => s.folderName)),
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  const openRenamePlaylist = (playlist: PlaylistSummary) => {
    setRowError(null);
    setRenameTarget({
      kind: "playlist",
      target: playlist,
      preview: "", // .jcp files don't have inbound references
      existingNames: new Set(
        playlists.map((p) => p.filename.replace(/\.jcp$/i, "")),
      ),
    });
  };

  const openRenameTrackMap = async (trackMap: TrackMapSummary) => {
    setRowError(null);
    try {
      const refs = await findPlaylistsReferencingTrackMap(
        playlists,
        trackMap.filename,
      );
      const preview =
        refs.length === 0
          ? ""
          : `This will also update the <trackmap> in ${refs.length} ${refs.length === 1 ? "playlist" : "playlists"}: ${refs.map((r) => r.filename).join(", ")}.`;
      setRenameTarget({
        kind: "trackMap",
        target: trackMap,
        preview,
        existingNames: new Set(
          trackMaps.map((t) => t.filename.replace(/\.jcm$/i, "")),
        ),
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Rename: actual perform-the-rename pipelines, called by the dialog --

  const performRenameSong = async (song: SongSummary, newName: string) => {
    if (!state.workingFolder) throw new Error("No working folder.");
    // 1. Load + update each referencing playlist's <song_name> entries.
    //    We re-load here (not reusing the openRenameSong list) so we
    //    catch any new playlists created since the dialog opened.
    const refs = await findPlaylistsReferencingSong(playlists, song.folderName);
    for (const ref of refs) {
      const text = await readTextFile(ref.path);
      const playlist = parsePlaylist(text);
      playlist.songNames = playlist.songNames.map((n) =>
        n === song.folderName ? newName : n,
      );
      await writeTextFile(ref.path, writePlaylist(playlist));
    }
    // 2. Rename folder + inner .jcs.
    const created = await renameSong(
      state.workingFolder,
      song.folderName,
      newName,
    );
    // 3. Rescan + reselect if this song was open.
    await rescan();
    if (sel?.kind === "song" && sel.jcsPath === song.jcsPath) {
      dispatch({
        type: "select",
        selection: { kind: "song", jcsPath: created.jcsPath },
      });
    }
  };

  const performRenamePlaylist = async (
    playlist: PlaylistSummary,
    newName: string,
  ) => {
    if (!state.workingFolder) throw new Error("No working folder.");
    // 1. Update <playlist_display_name> inside the file (so the
    //    BandMate's on-screen label tracks the rename — the create
    //    flow uses the same convention: filename = display name).
    const text = await readTextFile(playlist.path);
    const parsed = parsePlaylist(text);
    parsed.displayName = newName;
    await writeTextFile(playlist.path, writePlaylist(parsed));
    // 2. Rename the .jcp on disk.
    const created = await renamePlaylist(
      state.workingFolder,
      playlist.path,
      newName,
    );
    // 3. Rescan + reselect.
    await rescan();
    if (sel?.kind === "playlist" && sel.path === playlist.path) {
      dispatch({
        type: "select",
        selection: { kind: "playlist", path: created.jcpPath },
      });
    }
  };

  const performRenameTrackMap = async (
    trackMap: TrackMapSummary,
    newName: string,
  ) => {
    if (!state.workingFolder) throw new Error("No working folder.");
    const newFilename = `${newName}.jcm`;
    // 1. Update each referencing playlist's <trackmap>.
    const refs = await findPlaylistsReferencingTrackMap(
      playlists,
      trackMap.filename,
    );
    for (const ref of refs) {
      const text = await readTextFile(ref.path);
      const playlist = parsePlaylist(text);
      playlist.trackMap = newFilename;
      await writeTextFile(ref.path, writePlaylist(playlist));
    }
    // 2. Rename the .jcm.
    const newPath = await renameTrackMap(
      state.workingFolder,
      trackMap.path,
      newName,
    );
    // 3. Rescan + reselect.
    await rescan();
    if (sel?.kind === "trackMap" && sel.path === trackMap.path) {
      dispatch({
        type: "select",
        selection: { kind: "trackMap", path: newPath },
      });
    }
  };

  // ---- Context-menu wiring ------------------------------------------------

  const openMenu = (
    e: React.MouseEvent,
    items: OpenContextMenu["items"],
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, items });
  };

  // Rename items per type — each opens the RenameDialog after pre-loading
  // any cross-reference impact (so the dialog shows the impact line
  // immediately).
  const renameSongItem = (s: SongSummary) => ({
    label: "Rename…",
    onClick: () => void openRenameSong(s),
  });
  const renamePlaylistItem = (p: PlaylistSummary) => ({
    label: "Rename…",
    onClick: () => openRenamePlaylist(p),
  });
  const renameTrackMapItem = (tm: TrackMapSummary) => ({
    label: "Rename…",
    onClick: () => void openRenameTrackMap(tm),
  });

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      {rowError && (
        <p
          role="alert"
          className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {rowError}
          <button
            type="button"
            onClick={() => setRowError(null)}
            className="ml-2 underline"
          >
            dismiss
          </button>
        </p>
      )}
      <nav className="flex flex-col">
        <Section
          title="Songs"
          count={songs.length}
          action={
            <SectionAction
              label="New Song"
              ariaLabel="New Song"
              onClick={() => setNewSongOpen(true)}
            />
          }
        >
          {songs.length === 0 ? (
            <SectionEmpty hint="Hit the + button above to add a new song." />
          ) : (
            songs.map((s) => {
              const isActive =
                sel?.kind === "song" && sel.jcsPath === s.jcsPath;
              return (
                <SidebarRow
                  key={s.jcsPath}
                  label={s.folderName}
                  title={`${s.folderName}.jcs${isActive ? " (click to deselect)" : ""}`}
                  active={isActive}
                  onClick={() =>
                    toggleSelect(
                      { kind: "song", jcsPath: s.jcsPath },
                      isActive,
                    )
                  }
                  onContextMenu={(e) =>
                    openMenu(e, [
                      {
                        label: "Open in Finder",
                        onClick: () => void revealInFileManager(s.folderPath),
                      },
                      "divider",
                      renameSongItem(s),
                      {
                        label: "Duplicate",
                        onClick: () => void handleDuplicateSong(s),
                      },
                      "divider",
                      {
                        label: "Delete",
                        onClick: () => void handleDeleteSong(s),
                        danger: true,
                      },
                    ])
                  }
                />
              );
            })
          )}
        </Section>

        <Section
          title="Playlists"
          count={playlists.length}
          action={
            <SectionAction
              label="New Playlist"
              ariaLabel="New Playlist"
              onClick={() => setNewPlaylistOpen(true)}
            />
          }
        >
          {playlists.length === 0 ? (
            <SectionEmpty hint="Hit the + button above to create a new playlist." />
          ) : (
            playlists.map((p) => {
              const isActive =
                sel?.kind === "playlist" && sel.path === p.path;
              return (
                <SidebarRow
                  key={p.path}
                  label={p.filename.replace(/\.jcp$/i, "")}
                  title={`${p.filename}${isActive ? " (click to deselect)" : ""}`}
                  active={isActive}
                  onClick={() =>
                    toggleSelect({ kind: "playlist", path: p.path }, isActive)
                  }
                  onContextMenu={(e) =>
                    openMenu(e, [
                      {
                        label: "Open in Finder",
                        onClick: () => void revealInFileManager(p.path),
                      },
                      "divider",
                      renamePlaylistItem(p),
                      {
                        label: "Duplicate",
                        onClick: () => void handleDuplicatePlaylist(p),
                      },
                      "divider",
                      {
                        label: "Delete",
                        onClick: () => void handleDeletePlaylist(p),
                        danger: true,
                      },
                    ])
                  }
                />
              );
            })
          )}
        </Section>

        <Section
          ref={trackMapsSectionRef}
          title="Track Maps"
          count={trackMaps.length}
          highlight={isDragOver}
          dropLabel="Drop to import track map"
          action={
            <SectionAction
              label="New Track Map"
              ariaLabel="New Track Map"
              onClick={(e) =>
                openMenu(e, [
                  {
                    label: "New track map…",
                    onClick: () => setNewTrackMapOpen(true),
                  },
                  {
                    label: "Import from another folder…",
                    onClick: () => {
                      setImportPrepopulated(null);
                      setImportTrackMapOpen(true);
                    },
                  },
                ])
              }
            />
          }
        >
          {trackMaps.length === 0 ? (
            <SectionEmpty hint="Hit the + button above to name your output channels." />
          ) : (
            // Split into seeded (default_tm, stems_tm) + user-created.
            // Seeded renders first with a "Template" badge so it reads
            // as starter content rather than ad-hoc user data; hairline
            // divider separates the two groups when both exist. Within
            // each group, the order is whatever the scan returned
            // (alphabetical today).
            (() => {
              const seeded = trackMaps.filter((tm) =>
                SEEDED_TRACKMAP_FILENAMES.has(tm.filename),
              );
              const userCreated = trackMaps.filter(
                (tm) => !SEEDED_TRACKMAP_FILENAMES.has(tm.filename),
              );
              const renderRow = (
                tm: (typeof trackMaps)[number],
                isSeeded: boolean,
              ) => {
                const isActive =
                  sel?.kind === "trackMap" && sel.path === tm.path;
                return (
                  <SidebarRow
                    key={tm.path}
                    // Display = filename without `_tm.jcm`. Safe because
                    // NewTrackMapDialog auto-appends `_tm` on create —
                    // the suffix is never user-typed. Full filename
                    // available in the hover tooltip via `title`.
                    // See matching comment in TrackMapEditor.trackMapName.
                    label={tm.filename.replace(/_tm\.jcm$|\.jcm$/i, "")}
                    title={`${tm.filename}${isActive ? " (click to deselect)" : ""}`}
                    active={isActive}
                    trailing={
                      isSeeded ? <TemplateBadge isSelected={isActive} /> : undefined
                    }
                    onClick={() =>
                      toggleSelect({ kind: "trackMap", path: tm.path }, isActive)
                    }
                    onContextMenu={(e) =>
                      openMenu(e, [
                        {
                          label: "Open in Finder",
                          onClick: () => void revealInFileManager(tm.path),
                        },
                        "divider",
                        renameTrackMapItem(tm),
                        {
                          label: "Duplicate",
                          onClick: () => void handleDuplicateTrackMap(tm),
                        },
                        "divider",
                        {
                          label: "Delete",
                          onClick: () => void handleDeleteTrackMap(tm),
                          danger: true,
                        },
                      ])
                    }
                  />
                );
              };
              return (
                <>
                  {seeded.map((tm) => renderRow(tm, true))}
                  {seeded.length > 0 && userCreated.length > 0 && (
                    <div
                      aria-hidden="true"
                      className="mx-4 my-1 border-t border-zinc-200 dark:border-zinc-800"
                    />
                  )}
                  {userCreated.map((tm) => renderRow(tm, false))}
                </>
              );
            })()
          )}
        </Section>
      </nav>
      <NewSongDialog
        isOpen={newSongOpen}
        onClose={() => setNewSongOpen(false)}
      />
      <NewPlaylistDialog
        isOpen={newPlaylistOpen}
        onClose={() => setNewPlaylistOpen(false)}
      />
      <NewTrackMapDialog
        isOpen={newTrackMapOpen}
        onClose={() => setNewTrackMapOpen(false)}
      />
      <ImportTrackMapDialog
        isOpen={importTrackMapOpen}
        prepopulated={importPrepopulated}
        onClose={() => {
          setImportTrackMapOpen(false);
          setImportPrepopulated(null);
        }}
      />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <RenameDialog
        isOpen={renameTarget !== null}
        itemKind={
          renameTarget?.kind === "song"
            ? "song"
            : renameTarget?.kind === "playlist"
              ? "playlist"
              : "track map"
        }
        currentName={
          renameTarget?.kind === "song"
            ? renameTarget.target.folderName
            : renameTarget?.kind === "playlist"
              ? renameTarget.target.filename.replace(/\.jcp$/i, "")
              : renameTarget?.kind === "trackMap"
                ? renameTarget.target.filename.replace(/\.jcm$/i, "")
                : ""
        }
        existingNames={renameTarget?.existingNames ?? new Set()}
        previewMessage={renameTarget?.preview ?? null}
        onClose={() => setRenameTarget(null)}
        onRename={async (newName) => {
          if (!renameTarget) return;
          if (renameTarget.kind === "song") {
            await performRenameSong(renameTarget.target, newName);
          } else if (renameTarget.kind === "playlist") {
            await performRenamePlaylist(renameTarget.target, newName);
          } else {
            await performRenameTrackMap(renameTarget.target, newName);
          }
        }}
      />
    </aside>
  );
}

const Section = forwardRef<
  HTMLDetailsElement,
  {
    title: string;
    count: number;
    /**
     * Optional inline action (e.g., a "+" button) shown to the right of
     * the section title. Click events on the action don't toggle the
     * collapsible — the action stops propagation itself.
     */
    action?: ReactNode;
    /**
     * When true, render an overt drop-zone overlay over the section's
     * body, plus a ring on the section itself. Set by the parent's
     * drag-drop listener while eligible files are dragged over this
     * section. Text content of the overlay is `dropLabel`.
     */
    highlight?: boolean;
    /**
     * Label shown inside the drop-zone overlay when `highlight` is on.
     * Renders nothing if undefined.
     */
    dropLabel?: string;
    children: ReactNode;
  }
>(function Section(
  { title, count, action, highlight, dropLabel, children },
  ref,
) {
  return (
    <details
      ref={ref}
      open
      className={cn(
        "group border-b border-zinc-200 transition last:border-b-0 dark:border-zinc-800",
        highlight && "ring-2 ring-inset ring-brand-400",
      )}
    >
      <summary className="bms-summary flex cursor-pointer items-center justify-between px-4 pt-4 pb-2 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60">
        <div className="flex items-center gap-1.5">
          <Chevron className="h-3 w-3 text-zinc-500 transition-transform group-open:rotate-90" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {action}
          <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {count}
          </span>
        </div>
      </summary>
      <div className="relative min-h-[3.5rem] pb-3">
        {children}
        {highlight && dropLabel && (
          // pointer-events-none so the drop event still reaches the
          // window-level Tauri listener (which is what actually
          // dispatches the file paths to JS).
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 inset-y-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-400 bg-brand-50/95 px-3 text-center shadow-sm backdrop-blur-sm dark:border-brand-400 dark:bg-brand-950/90"
          >
            <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
              {dropLabel}
            </span>
          </div>
        )}
      </div>
    </details>
  );
});

/**
 * Tiny "+" action button shown next to a Section header. Stops click
 * propagation so it doesn't toggle the parent <details>.
 */
function SectionAction({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  /**
   * Click handler. Receives the React mouse event so callers that want
   * to open a popover menu (Track Maps section uses this for the New /
   * Import menu) can pass the event to `openMenu` for positioning.
   */
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      title={label}
      aria-label={ariaLabel}
      className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <PlusIcon className="h-3 w-3" />
    </button>
  );
}

function SectionEmpty({ hint }: { hint: string }) {
  return (
    <p className="px-4 py-2 text-xs italic text-zinc-500 dark:text-zinc-600">
      {hint}
    </p>
  );
}

function SidebarRow({
  label,
  title,
  active,
  trailing,
  onClick,
  onContextMenu,
}: {
  label: string;
  title?: string;
  active?: boolean;
  /**
   * Optional trailing content rendered right-aligned in the row.
   * Used for the "Template" badge on seeded trackmaps. Shrinks to
   * fit; the label truncates around it.
   */
  trailing?: ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition",
        active
          ? "bg-brand-500 text-white"
          : "text-zinc-800 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-900",
      )}
      title={title ?? label}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

/**
 * Filenames seeded into every fresh working folder by Rust
 * `init_working_folder` (see lib.rs `SEED_DEFAULT_TM` / `SEED_STEMS_TM`).
 * These render at the top of the Track Maps section with a "Template"
 * badge so they read as starter content rather than user data.
 */
const SEEDED_TRACKMAP_FILENAMES = new Set([
  "default_tm.jcm",
  "stems_tm.jcm",
]);

/**
 * Small muted pill used for the "Template" tag on seeded trackmaps.
 * Inverts to a white-tinted look when the row is selected (blue bg)
 * so the badge stays legible against the brand-blue fill.
 */
function TemplateBadge({ isSelected }: { isSelected: boolean }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0 text-3xs font-semibold uppercase tracking-wider",
        isSelected
          ? "border-white/40 text-white/80"
          : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
      )}
      // No hover affordance — it's a label, not an action.
    >
      Template
    </span>
  );
}

/** Plain "+" glyph — same stroke style as the chevron. */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
