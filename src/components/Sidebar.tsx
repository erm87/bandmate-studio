/**
 * Left sidebar with three sections: Songs, Playlists, Track Maps.
 *
 * UX notes (Phase 2 v2):
 *   - Sidebar scrolls independently of the main pane (`overflow-y-auto`).
 *   - Each section is collapsible (native <details>/<summary>); all
 *     start expanded. Collapsed state is per-mount only — we don't
 *     persist it across launches in v0.1.
 *   - Rows show only the primary name (e.g. "Buffy"), not the redundant
 *     filename underneath.
 *
 * For Phase 2 the rows are not yet selectable — clicking does nothing.
 * Phase 3 will wire up selection and an editor pane on the right.
 */

import type { ReactNode } from "react";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

export function Sidebar() {
  const { state } = useAppState();
  const { songs, playlists, trackMaps } = state.scan;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <nav className="flex flex-col">
        <Section title="Songs" count={songs.length}>
          {songs.length === 0 ? (
            <SectionEmpty hint="Use “New Song” to add one." />
          ) : (
            songs.map((s) => (
              <SidebarRow
                key={s.jcsPath}
                label={s.folderName}
                title={`${s.folderName}.jcs`}
              />
            ))
          )}
        </Section>

        <Section title="Playlists" count={playlists.length}>
          {playlists.length === 0 ? (
            <SectionEmpty hint="Build a playlist from your songs." />
          ) : (
            playlists.map((p) => (
              <SidebarRow
                key={p.path}
                label={p.filename.replace(/\.jcp$/i, "")}
                title={p.filename}
              />
            ))
          )}
        </Section>

        <Section title="Track Maps" count={trackMaps.length}>
          {trackMaps.length === 0 ? (
            <SectionEmpty hint="Track maps name your output channels." />
          ) : (
            trackMaps.map((tm) => (
              <SidebarRow
                key={tm.path}
                label={tm.filename.replace(/_tm\.jcm$|\.jcm$/i, "")}
                title={tm.filename}
              />
            ))
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
}: {
  label: string;
  /** Tooltip — useful for showing the underlying filename on hover. */
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
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

/**
 * Inline SVG chevron-right. Inlined to avoid pulling in an icon library
 * for a single shape. Rotates to chevron-down via the `group-open`
 * variant in the parent `<details>`.
 */
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
