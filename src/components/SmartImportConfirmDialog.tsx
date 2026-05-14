/**
 * Smart Import — replacement-confirmation dialog.
 *
 * Triggered from `SongEditor.handleImportAll` when at least one
 * candidate file fuzzy-matches a channel that already has an
 * assignment. The user reviews per-channel "current → proposed" rows
 * and chooses which replacements to apply.
 *
 * Why a dedicated dialog vs. a native `ask()`:
 *   - The user needs to see the per-row before/after pairs and
 *     selectively opt-in. Native prompts can't render that table.
 *   - Two-button decisions don't model "approve some, skip others" —
 *     we need checkboxes plus a separate "skip auto-mapping entirely"
 *     escape hatch.
 *
 * Design choices:
 *   - All checkboxes default to **checked**. The fuzzy matcher
 *     surfaced these because it thinks each replacement is correct;
 *     the dialog is the user's audit step. Opt-out beats opt-in.
 *   - Select all / Deselect all toggle at the top for bulk action.
 *   - Three actions in the footer:
 *       * Cancel — close the dialog, no copies, no assignments.
 *       * Import without auto-mapping — copy every candidate into the
 *         song folder, apply NO channel assignments (not even the
 *         empty-channel matches the parent already computed). A
 *         one-time opt-out: the Smart Mapping preference itself isn't
 *         touched.
 *       * Confirm — apply the **checked** replacements (plus the
 *         empty-channel auto-fills the parent computed); copy every
 *         file. Unchecked replacements still copy in, just without
 *         an assignment — the user can click-assign later.
 *
 * Scope: this PR shows the dialog *only* when at least one
 * replacement is being proposed (per the user's "replacements only"
 * choice in the design step). Empty-channel matches auto-apply
 * silently; they don't appear in this dialog.
 */

import { useEffect, useState } from "react";
import { Button } from "./Button";
import { MIDI_CHANNEL_INDEX } from "../codec";

/**
 * A single proposed replacement: which channel, what's there now,
 * and what Smart Mapping wants to put there instead.
 *
 * `channelIndex` is the song's channel slot (0..23 for audio, 24 for
 * the MIDI slot). The dialog uses it as the row key and surfaces it
 * back to the parent via `onConfirm`'s Set so the parent knows which
 * channels were approved without needing to re-key by filename.
 */
export interface ProposedReplacement {
  channelIndex: number;
  /**
   * Track-map label for this channel. Empty string for unlabeled
   * channels (the channel number is still shown so the user can
   * place the row visually). For the MIDI slot we surface the label
   * "MIDI" regardless of the underlying track-map label since the
   * row's purpose is unambiguous.
   */
  channelLabel: string;
  /** Filename currently assigned to this channel. */
  currentFilename: string;
  /**
   * Filename being proposed by Smart Mapping (the source-folder
   * winner for this channel). Different from `currentFilename` by
   * definition — if they matched, there'd be no replacement to
   * propose.
   */
  proposedFilename: string;
}

interface Props {
  isOpen: boolean;
  /**
   * Display name shown in the headline subtitle, e.g. the song's
   * folder name. Matches `CleanupConfirmDialog`'s pattern so the
   * user has consistent dialog identity across the editor.
   */
  songName: string;
  replacements: ProposedReplacement[];
  /**
   * Called when the user clicks **Confirm**. Receives the set of
   * channel indices whose replacement was approved. Channels NOT in
   * the set should still have their proposed file copied into the
   * song folder (unassigned) so it's available for later click-
   * assign — same friendly behavior as today's direct-copy bucket
   * for files that didn't match anywhere.
   */
  onConfirm: (acceptedChannels: Set<number>) => void;
  /**
   * Called when the user clicks **Import without auto-mapping**. The
   * parent should apply NO channel assignments at all (not even the
   * empty-channel matches it had already computed) and copy every
   * candidate file into the song folder. One-time override; doesn't
   * change `userPrefs.smartMappingEnabled`.
   */
  onImportWithoutAutoMapping: () => void;
  onCancel: () => void;
}

/**
 * Human label for the channel column. MIDI slot gets a distinct
 * pill-style label so it's not mistaken for audio channel 25.
 */
function channelDisplayLabel(channelIndex: number): {
  prefix: string;
  label: string;
} {
  if (channelIndex === MIDI_CHANNEL_INDEX) {
    return { prefix: "MID", label: "" };
  }
  return { prefix: `Ch ${channelIndex + 1}`, label: "" };
}

export function SmartImportConfirmDialog({
  isOpen,
  songName,
  replacements,
  onConfirm,
  onImportWithoutAutoMapping,
  onCancel,
}: Props) {
  // Init checked-set to every replacement. Re-seed each time the
  // dialog opens so a previous user's deselections don't leak across
  // import sessions.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (isOpen) {
      setChecked(new Set(replacements.map((r) => r.channelIndex)));
    }
  }, [isOpen, replacements]);

  // Esc cancels (same convention as CleanupConfirmDialog).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const allChecked =
    replacements.length > 0 && checked.size === replacements.length;
  const noneChecked = checked.size === 0;

  const toggle = (channelIndex: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(channelIndex)) next.delete(channelIndex);
      else next.add(channelIndex);
      return next;
    });
  };

  const handleSelectAll = () => {
    setChecked(new Set(replacements.map((r) => r.channelIndex)));
  };
  const handleDeselectAll = () => {
    setChecked(new Set());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-import-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="smart-import-confirm-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Replace {replacements.length} existing assignment
            {replacements.length === 1 ? "" : "s"}?
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="user-text">{songName}</span>
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Smart Mapping found newer source files that match channels
            you've already assigned. Pick which ones to swap in.
            Unchecked files still copy into the song folder so you can
            click-assign them later if you change your mind.
          </p>

          {/* Select-all bar — mirrors the file-list pattern used in
              CleanupConfirmDialog so the dialog reads as part of the
              same family. */}
          <div className="flex items-center justify-between border-b border-zinc-200 pb-1.5 dark:border-zinc-800">
            <span className="text-meta text-zinc-500 dark:text-zinc-400">
              {checked.size} of {replacements.length} selected
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={allChecked}
                className="rounded px-2 py-0.5 text-xs text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-300 dark:hover:bg-brand-950/40"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                disabled={noneChecked}
                className="rounded px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Deselect all
              </button>
            </div>
          </div>

          <ul className="flex flex-col gap-1 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
            {replacements.map((r) => {
              const isChecked = checked.has(r.channelIndex);
              const { prefix } = channelDisplayLabel(r.channelIndex);
              return (
                <li key={r.channelIndex}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded px-2 py-1.5 transition-colors ${
                      isChecked
                        ? "bg-white dark:bg-zinc-900"
                        : "hover:bg-white/60 dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(r.channelIndex)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-2xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          {prefix}
                        </span>
                        {r.channelLabel && (
                          <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                            {r.channelLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5 font-mono text-xs">
                        <span
                          className="user-text truncate text-zinc-500 line-through decoration-zinc-400 dark:text-zinc-500 dark:decoration-zinc-600"
                          title={r.currentFilename}
                        >
                          {r.currentFilename}
                        </span>
                        <span
                          className="user-text truncate text-brand-700 dark:text-brand-300"
                          title={r.proposedFilename}
                        >
                          → {r.proposedFilename}
                        </span>
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
            Replacements you confirm here go through the normal edit
            history — Undo works, and the row shows a change dot until
            you Save.
          </p>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="tertiary" onClick={onImportWithoutAutoMapping}>
            Import without auto-mapping
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(checked)}
            disabled={noneChecked && replacements.length > 0}
          >
            {checked.size === replacements.length
              ? `Replace ${replacements.length} file${replacements.length === 1 ? "" : "s"}`
              : checked.size === 0
                ? "Replace none"
                : `Replace ${checked.size} of ${replacements.length}`}
          </Button>
        </footer>
      </div>
    </div>
  );
}
