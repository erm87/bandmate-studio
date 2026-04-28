/**
 * Generic Rename modal — used for songs, playlists, and track maps.
 *
 * The dialog itself is "dumb": validates the new name against the
 * caller-supplied `existingNames` set, surfaces a caller-supplied
 * `previewMessage` line above the buttons (e.g., "Updates references
 * in 3 playlists"), and calls back to `onRename(newName)` on submit.
 *
 * The Sidebar pre-loads the cross-reference preview before opening
 * the dialog — that way the preview is already visible when the
 * dialog appears, no in-dialog loading state to manage.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  /** What kind of thing we're renaming, e.g. "song", "playlist", "track map". */
  itemKind: "song" | "playlist" | "track map";
  currentName: string;
  /**
   * Names already in use for this item kind (bare names, no extension).
   * The dialog blocks Submit if the new name collides.
   */
  existingNames: Set<string>;
  /**
   * Pre-rendered description of any cross-reference impact, e.g.
   * "Updates references in 2 playlists: May v3.jcp, Spring 2026.jcp".
   * Pass `null` or `""` for no preview.
   */
  previewMessage: string | null;
  onClose: () => void;
  /** Caller does the actual rename + cascade work; dialog awaits this. */
  onRename: (newName: string) => Promise<void>;
}

function validateName(
  name: string,
  currentName: string,
  existingNames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required.";
  if (trimmed.length > 64) return "Name is too long (max 64 characters).";
  if (trimmed.startsWith(".")) return "Name cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  if (trimmed === currentName.trim()) {
    return "New name is the same as the current name.";
  }
  if (existingNames.has(trimmed)) {
    return `A ${trimmed === currentName.trim() ? "" : "different "}item named "${trimmed}" already exists.`;
  }
  return null;
}

export function RenameDialog({
  isOpen,
  itemKind,
  currentName,
  existingNames,
  previewMessage,
  onClose,
  onRename,
}: Props) {
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form on open. Pre-fill with the current name and select all
  // so the user can just start typing the new name.
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setSubmitting(false);
      setSubmitError(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen, currentName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, submitting, onClose]);

  const validationError = validateName(name, currentName, existingNames);
  const showValidationError =
    name.length > 0 && name !== currentName && validationError !== null;
  const canSubmit = !submitting && validationError === null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onRename(name.trim());
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Capitalize for the dialog title, e.g. "Rename Song"
  const titleNoun =
    itemKind === "track map" ? "Track Map" : itemKind[0]!.toUpperCase() + itemKind.slice(1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="rename-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Rename {titleNoun}
          </h2>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Current:{" "}
            <span className="user-text font-mono text-zinc-700 dark:text-zinc-300">
              {currentName}
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              New Name
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              disabled={submitting}
              className={cn(
                "user-text rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 dark:bg-zinc-950",
                showValidationError
                  ? "border-red-300 focus-visible:ring-red-400 dark:border-red-700"
                  : "border-zinc-300 focus-visible:ring-brand-400 dark:border-zinc-700",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            {showValidationError && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {validationError}
              </span>
            )}
          </label>

          {previewMessage && previewMessage.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {previewMessage}
            </p>
          )}

          {submitError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {submitError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              canSubmit
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            {submitting ? "Renaming…" : "Rename"}
          </button>
        </footer>
      </div>
    </div>
  );
}
