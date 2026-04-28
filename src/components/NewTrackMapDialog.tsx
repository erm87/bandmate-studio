/**
 * New Track Map wizard — modal dialog.
 *
 * Two inputs:
 *   1. Name (becomes the .jcm filename, e.g. "myband_tm.jcm")
 *   2. Template (Empty / Default / Stems / Brigades-style)
 *
 * On Create:
 *   - Calls Rust `create_track_map` to reserve `<name>.jcm`
 *   - Writes the templated TrackMap via the codec
 *   - Triggers a working-folder rescan
 *   - Dispatches `select` so the editor opens on the new track map
 *
 * Templates are defined in `src/codec/index.ts` (see
 * `TRACK_MAP_TEMPLATE_DESCRIPTIONS` and `createEmptyTrackMap`). Adding
 * a new template is a one-place change there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TRACK_MAP_TEMPLATE_DESCRIPTIONS,
  createEmptyTrackMap,
  writeTrackMap,
  type TrackMapTemplate,
} from "../codec";
import { createTrackMap, writeTextFile } from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const TEMPLATE_LABELS: Record<TrackMapTemplate, string> = {
  empty: "Empty",
  default: "Default",
  stems: "Stems",
  brigades: "Brigades-style",
};

const TEMPLATE_OPTIONS: TrackMapTemplate[] = [
  "empty",
  "default",
  "stems",
  "brigades",
];

/** Mirrors the Rust validator in `create_track_map`. */
function validateName(
  name: string,
  existingFilenames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required.";
  if (trimmed.length > 64) return "Name is too long (max 64 characters).";
  if (trimmed.startsWith(".")) return "Name cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  if (existingFilenames.has(`${trimmed}.jcm`)) {
    return `A track map named "${trimmed}" already exists.`;
  }
  return null;
}

export function NewTrackMapDialog({ isOpen, onClose }: Props) {
  const { state, dispatch, rescan } = useAppState();

  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TrackMapTemplate>("default");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setTemplate("default");
      setCreating(false);
      setCreateError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, creating, onClose]);

  const existingFilenames = useMemo(
    () => new Set(state.scan.trackMaps.map((tm) => tm.filename)),
    [state.scan.trackMaps],
  );

  const validationError = validateName(name, existingFilenames);
  const showValidationError = name.length > 0 && validationError !== null;
  const canCreate =
    !creating && validationError === null && state.workingFolder !== null;

  const handleCreate = async () => {
    if (!canCreate || !state.workingFolder) return;
    setCreating(true);
    setCreateError(null);
    try {
      // 1. Reserve the .jcm filename.
      const created = await createTrackMap(state.workingFolder, name.trim());
      // 2. Write the template via the codec.
      const map = createEmptyTrackMap(template);
      await writeTextFile(created.jcmPath, writeTrackMap(map));
      // 3. Refresh the sidebar.
      await rescan();
      // 4. Auto-open in the track-map editor.
      dispatch({
        type: "select",
        selection: { kind: "trackMap", path: created.jcmPath },
      });
      onClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-trackmap-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="new-trackmap-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            New Track Map
          </h2>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Name
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="brigades_tm"
              maxLength={64}
              disabled={creating}
              className={cn(
                "user-text rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 dark:bg-zinc-950",
                showValidationError
                  ? "border-red-300 focus-visible:ring-red-400 dark:border-red-700"
                  : "border-zinc-300 focus-visible:ring-brand-400 dark:border-zinc-700",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
            {showValidationError && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {validationError}
              </span>
            )}
            <span className="text-[11px] text-zinc-500">
              Becomes the .jcm filename. The BandMate references this from a
              playlist's <span className="font-mono">&lt;trackmap&gt;</span> tag.
            </span>
          </label>

          {/* Template */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Template
            </legend>
            <div className="flex flex-col gap-1.5">
              {TEMPLATE_OPTIONS.map((opt) => (
                <TemplateRadio
                  key={opt}
                  value={opt}
                  label={TEMPLATE_LABELS[opt]}
                  description={TRACK_MAP_TEMPLATE_DESCRIPTIONS[opt]}
                  isSelected={template === opt}
                  onSelect={() => setTemplate(opt)}
                  disabled={creating}
                />
              ))}
            </div>
          </fieldset>

          {createError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {createError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              canCreate
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TemplateRadio({
  value,
  label,
  description,
  isSelected,
  onSelect,
  disabled,
}: {
  value: TrackMapTemplate;
  label: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50",
        isSelected
          ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
          isSelected
            ? "border-brand-500 dark:border-brand-400"
            : "border-zinc-300 dark:border-zinc-700",
        )}
        aria-hidden="true"
      >
        {isSelected && (
          <span className="h-2 w-2 rounded-full bg-brand-500 dark:bg-brand-400" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-sm font-medium",
            isSelected
              ? "text-brand-900 dark:text-brand-100"
              : "text-zinc-700 dark:text-zinc-300",
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {description}
        </span>
      </span>
      {/* Hidden value attribute for completeness; not actually used (the
          parent passes the template directly). */}
      <span hidden>{value}</span>
    </button>
  );
}
