/**
 * Left sidebar with three sections: Songs, Playlists, Track Maps.
 *
 * Phase 3a: rows are now clickable. Clicking dispatches a `select`
 * action; the active row gets a brand highlight and the editor pane
 * on the right opens the matching item.
 */

import type { ReactNode } from "react";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

export function Sidebar() {
  const { state, dispatch } = useAppState();
  const { songs, playlists, trackMaps } = state.scan;
  const sel = state.selection;

  /**
   * Click handler: dispatching select on the already-active row clears
   * the selection (toggle behavior). This gives the user a way to
   * return to the working-folder stats view from the same control they
   * used to enter an editor.
   */
  const toggleSelect = (
    selection:
      | { kind: "song"; jcsPath: string }
      | { kind: "playlist"; path: string }
      | { kind: "trackMap"; path: string },
    isActive: boolean,
  ) => {
    if (isActive) {
      dispatch({ type: "clear_selection" });
    } else {
      dispatch({ type: "select", selection });
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <nav className="flex flex-col">
        <Section title="Songs" count={songs.length}>
          {songs.length === 0 ? (
            <SectionEmpty hint="Use “New Song” to add one." />
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
                />
              );
            })
          )}
        </Section>

        <Section title="Playlists" count={playlists.length}>
          {playlists.length === 0 ? (
            <SectionEmpty hint="Build a playlist from your songs." />
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
                />
              );
            })
          )}
        </Section>

        <Section title="Track Maps" count={trackMaps.length}>
          {trackMaps.length === 0 ? (
            <SectionEmpty hint="Track maps name your output channels." />
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
                />
              );
            })
          )}
        </Section>
      </nav>
    </aside>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
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
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {count}
        </span>
      </summary>
      <div className="pb-3">{children}</div>
    </details>
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
}: {
  label: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
