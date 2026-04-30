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

import { useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
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
  readTextFile,
  renamePlaylist,
  renameSong,
  renameTrackMap,
  revealInFileManager,
  writeTextFile,
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
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  /**
   * Active rename dialog. Carries the target item plus a pre-loaded
   * cross-reference preview so the dialog opens already populated.
   */
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

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
            <SectionEmpty hint="Use “+ New Song” above to add one." />
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
            <SectionEmpty hint="Use “+ New Playlist” above to build one from your songs." />
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
          title="Track Maps"
          count={trackMaps.length}
          action={
            <SectionAction
              label="New Track Map"
              ariaLabel="New Track Map"
              onClick={() => setNewTrackMapOpen(true)}
            />
          }
        >
          {trackMaps.length === 0 ? (
            <SectionEmpty hint="Use “+ New Track Map” above to name your output channels." />
          ) : (
            trackMaps.map((tm) => {
              const isActive =
                sel?.kind === "trackMap" && sel.path === tm.path;
              return (
                <SidebarRow
                  key={tm.path}
                  label={tm.filename.replace(/_tm\.jcm$|\.jcm$/i, "")}
                  title={`${tm.filename}${isActive ? " (click to deselect)" : ""}`}
                  active={isActive}
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
            })
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

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  /**
   * Optional inline action (e.g., a "+" button) shown to the right of
   * the section title. Click events on the action don't toggle the
   * collapsible — the action stops propagation itself.
   */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      open
      className="group border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
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
      <div className="pb-3">{children}</div>
    </details>
  );
}

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
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
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
  onClick,
  onContextMenu,
}: {
  label: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "block w-full truncate px-4 py-1.5 text-left text-sm transition",
        active
          ? "bg-brand-500 text-white"
          : "text-zinc-800 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-900",
      )}
      title={title ?? label}
    >
      {label}
    </button>
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
