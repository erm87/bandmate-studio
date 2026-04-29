/**
 * Reusable Save / Save as new… confirm modal.
 *
 * Replaces the inline `tauri.ask()` confirm we used in earlier phases.
 * Single combined view (not two-phase): Save overwrites the current
 * file; an inline name field lets the user save the current edits to
 * a brand new file under a new name without touching the original.
 *
 * Layout:
 *   ┌───────────────────────────────────────────┐
 *   │ Save Song                                 │
 *   ├───────────────────────────────────────────┤
 *   │ Save changes to "Buffy"?                  │
 *   │ <message body>                            │
 *   │                                           │
 *   │ Or save as a new copy:                    │
 *   │ ┌────────────────────────┐                │
 *   │ │ Buffy 2               │                │
 *   │ └────────────────────────┘                │
 *   │ ↳ inline validation                       │
 *   ├───────────────────────────────────────────┤
 *   │             Cancel  [Save as new] [Save]  │
 *   └───────────────────────────────────────────┘
 *
 * "Save as new" enables only when the input has a valid name that
 * doesn't collide with anything in `existingNames`.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  /** Header text, e.g. "Save Song" / "Save Playlist". */
  title: string;
  /** What's being saved (used in the body, e.g. `Save changes to "Buffy"?`). */
  subjectName: string;
  /**
   * Body content under the title — usually one line about overwrite
   * semantics + (for songs) any pending file copies.
   */
  message: React.ReactNode;
  /**
   * Names already in use (bare names, no extension). Used by the
   * collision check on the Save-as-new input.
   */
  existingNames: Set<string>;
  /** Pre-fill for the Save-as-new input, e.g. "Buffy 2". */
  defaultNewName: string;
  /**
   * Item kind label used in error messages, e.g. "song" / "playlist".
   * Lowercase, used inline in sentences.
   */
  itemKind: string;
  /** Called when the user clicks Save (overwrite). */
  onSave: () => Promise<void>;
  /** Called when the user clicks Save as new with a validated name. */
  onSaveAs: (newName: string) => Promise<void>;
  /** Close the dialog without saving. */
  onClose: () => void;
}

/** Validate a save-as name. Returns error string or null. */
function validate(
  name: string,
  existingNames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null; // empty = "no save-as"; not an error
  if (trimmed.length > 64) return "Name is too long (max 64 characters).";
  if (trimmed.startsWith(".")) return "Name cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  if (existingNames.has(trimmed)) {
    return `"${trimmed}" already exists.`;
  }
  return null;
}

export function SaveConfirmDialog({
  isOpen,
  title,
  subjectName,
  message,
  existingNames,
  defaultNewName,
  itemKind,
  onSave,
  onSaveAs,
  onClose,
}: Props) {
  const [newName, setNewName] = useState(defaultNewName);
  const [busy, setBusy] = useState<"save" | "saveAs" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNewName(defaultNewName);
      setBusy(null);
      setError(null);
    }
  }, [isOpen, defaultNewName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy === null) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, busy, onClose]);

  const validationError = validate(newName, existingNames);
  // "Save as new" is only enabled when the name is non-empty AND valid.
  const canSaveAs =
    busy === null &&
    newName.trim().length > 0 &&
    validationError === null;
  const canSave = busy === null;

  const handleSave = async () => {
    setBusy("save");
    setError(null);
    try {
      await onSave();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAs = async () => {
    if (!canSaveAs) return;
    setBusy("saveAs");
    setError(null);
    try {
      await onSaveAs(newName.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && busy === null) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="save-confirm-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {title}
          </h2>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Save changes to{" "}
            <span className="user-text font-mono">"{subjectName}"</span>?
          </p>
          <div className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
            {message}
          </div>

          <div className="mt-1 flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Or save as a new {itemKind}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={`New ${itemKind} name`}
                maxLength={64}
                disabled={busy !== null}
                className={cn(
                  "user-text rounded-md border bg-white px-3 py-1.5 font-mono text-xs text-zinc-700 shadow-sm focus:outline-none focus-visible:ring-2 dark:bg-zinc-950 dark:text-zinc-300",
                  validationError
                    ? "border-red-300 focus-visible:ring-red-400 dark:border-red-700"
                    : "border-zinc-300 focus-visible:ring-brand-400 dark:border-zinc-700",
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSaveAs) {
                    e.preventDefault();
                    void handleSaveAs();
                  }
                }}
              />
              {validationError && (
                <span className="text-[11px] text-red-600 dark:text-red-400">
                  {validationError}
                </span>
              )}
              {!validationError && (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
                  Leaves the original {itemKind} untouched and switches to
                  the new copy.
                </span>
              )}
            </label>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveAs}
            disabled={!canSaveAs}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              canSaveAs
                ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-600",
            )}
          >
            {busy === "saveAs" ? "Creating…" : "Save as new"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              canSave
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
