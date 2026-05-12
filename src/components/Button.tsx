/**
 * Shared Button component.
 *
 * Five variants encode the four tiers of "weight" the app uses for
 * actions plus the cancel-style ghost:
 *
 *   - primary   — filled brand color. The active in-context primary
 *                 action (Save, Create, Import, dialog confirm).
 *   - tonal     — light brand tint. Persistent or global actions
 *                 (Export to USB).
 *   - tertiary  — outlined neutral. Secondary serious action like a
 *                 dialog's "Save as new", or a "Change" affordance.
 *   - danger    — filled red. Destructive actions (Delete confirms).
 *                 Currently used in ContextMenu items; available here
 *                 for any future dialog/footer "Delete" button.
 *   - ghost     — text-only with hover bg. The standard "Cancel" /
 *                 "Close" / "Done" button in dialog footers.
 *
 * Three sizes:
 *
 *   - md (default) — `px-3 py-1.5 text-sm font-medium rounded-md`.
 *                    Used for dialog footers and any "action button"
 *                    at the dialog/page level.
 *   - sm           — `px-3 py-1   text-sm font-medium rounded-md`.
 *                    Same text size, less vertical padding. Used for
 *                    editor-header Save buttons that need to sit
 *                    inline with h-7 history icon buttons.
 *   - xs           — `px-2 py-1   text-xs font-medium rounded-md`.
 *                    True chip size — used for the source-folder
 *                    header's Clear / Change… pills. Reserve for
 *                    inline controls inside dense panel headers.
 *
 * Three interactive states per variant: rest, hover, active (click).
 * The `active:` press state is one tier darker than hover, which is
 * the convention across Carbon, Polaris, Radix, and Tailwind UI. It
 * works correctly for both mouse and touch input without needing
 * media queries, and gives instant tactile feedback on press —
 * relevant for touch-screen Macs.
 *
 * Disabled state is uniform across all variants: `opacity-50` +
 * `cursor-not-allowed`. Cleaner than the gray-swap pattern the
 * previous ad-hoc primary buttons used, and works for any variant.
 *
 * The first-run "Choose Working Folder" hero CTA is intentionally
 * left as a hand-rolled one-off. If we end up needing a third size
 * for hero / chip-with-icon / etc., add it then — don't bolt it on
 * preemptively.
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant =
  | "primary"
  | "tonal"
  | "tertiary"
  | "danger"
  | "ghost";

export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual tier. Defaults to "primary" because it's the most common
   * case — every dialog footer has a primary action.
   */
  variant?: ButtonVariant;
  /**
   * Size tier. Defaults to "md" — the dialog footer size. Use "sm"
   * for editor-header Save buttons that sit alongside h-7 icon
   * buttons; use "xs" for chip-style controls in dense panel
   * headers (Clear / Change… in the Source Files pane).
   */
  size?: ButtonSize;
}

/**
 * Size-specific layout classes. Same text size and rounding across
 * both sizes — only vertical padding differs — so the visual rhythm
 * of `sm` reads as "shorter sibling" rather than "different family."
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "rounded-md px-3 py-1.5 text-sm font-medium",
  sm: "rounded-md px-3 py-1 text-sm font-medium",
  xs: "rounded-md px-2 py-1 text-xs font-medium",
};

/**
 * Variant-specific color classes. Each variant covers light + dark
 * mode in three states (rest, hover, active). The shared shell
 * classes (type, focus ring, disabled) live in the component body.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-brand-500 text-white",
    "hover:bg-brand-600 active:bg-brand-700",
    // Brand color stays consistent in dark mode — same family,
    // slightly bumped saturation reads correctly on both backgrounds.
  ),
  tonal: cn(
    "bg-brand-50 text-brand-700",
    "hover:bg-brand-100 active:bg-brand-200",
    "dark:bg-brand-950/40 dark:text-brand-300",
    "dark:hover:bg-brand-900/40 dark:active:bg-brand-800/50",
  ),
  tertiary: cn(
    "border border-zinc-200 bg-white text-zinc-700",
    "hover:bg-zinc-50 active:bg-zinc-100",
    "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
    "dark:hover:bg-zinc-900 dark:active:bg-zinc-800",
  ),
  danger: cn(
    "bg-red-500 text-white",
    "hover:bg-red-600 active:bg-red-700",
    "dark:bg-red-600 dark:hover:bg-red-700 dark:active:bg-red-800",
  ),
  ghost: cn(
    "text-zinc-700",
    "hover:bg-zinc-100 active:bg-zinc-200",
    "dark:text-zinc-300",
    "dark:hover:bg-zinc-800 dark:active:bg-zinc-700",
  ),
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      className,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // Default to type="button" so a Button inside a <form> doesn't
        // accidentally submit. Caller can override with type="submit".
        type={type}
        className={cn(
          // Layout + type (size-dependent).
          SIZE_CLASSES[size],
          // Motion.
          "transition",
          // Focus ring — always the cyan accent, with offset so it
          // doesn't blend into the button's own fill.
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2",
          // Dark-mode focus offset against the app's zinc-950 surface.
          "dark:focus-visible:ring-offset-zinc-950",
          // Uniform disabled treatment. Variant-specific gray-swap is
          // intentionally NOT used — opacity-50 reads cleanly on every
          // variant and avoids per-variant disabled drift.
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANT_CLASSES[variant],
          // Escape hatch — callers can append spacing utilities like
          // `w-full`, `shrink-0`, alignment, etc. Avoid overriding
          // color/padding here.
          className,
        )}
        {...props}
      />
    );
  },
);
