/**
 * Lightweight right-click context menu.
 *
 * Usage: store an `OpenContextMenu | null` in state. Set it in your
 * `onContextMenu` handler with the cursor coords + the items you want
 * to show; render `<ContextMenu menu={...} onClose={...} />` at the
 * top of your component tree (or anywhere — it renders fixed-position).
 *
 * Closes on:
 *   - any click outside the menu
 *   - Escape key
 *   - clicking an item (after the item's onClick fires)
 *
 * Stays inside the viewport: if the requested position would put the
 * menu off-screen, we mirror it so the menu opens up/left from the
 * cursor instead.
 *
 * Why hand-rolled instead of Radix/Headless UI: we already have only
 * native title= tooltips elsewhere (see the Radix tooltip experiment
 * we reverted), and a context menu is a small enough surface that the
 * simpler, dependency-free path is fine.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

/** A single action in the context menu. */
export interface ContextMenuItem {
  /** Display label. */
  label: string;
  /** Click handler. The menu auto-closes after this fires. */
  onClick: () => void;
  /** Renders the label in red; used for destructive actions like Delete. */
  danger?: boolean;
  /** When true, the item renders disabled and click is ignored. */
  disabled?: boolean;
}

/** A divider between groups of items. Use `"divider"` in the items array. */
export type ContextMenuEntry = ContextMenuItem | "divider";

export interface OpenContextMenu {
  /** Cursor position (event.clientX/Y). */
  position: { x: number; y: number };
  /** Items to render. */
  items: ContextMenuEntry[];
}

interface Props {
  menu: OpenContextMenu | null;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Adjusted position after off-screen flip. We need the menu's
  // rendered size to compute this, so we render once at the requested
  // position then nudge in a layout effect.
  const [adjusted, setAdjusted] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!menu) {
      setAdjusted(null);
      return;
    }
    setAdjusted(menu.position);
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let { x, y } = menu.position;
    // 8px breathing room from the viewport edge.
    if (x + rect.width > viewportW - 8) x = viewportW - rect.width - 8;
    if (y + rect.height > viewportH - 8) y = viewportH - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    setAdjusted({ x, y });
  }, [menu]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!menu) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // mousedown so we close before the new click lands; otherwise the
    // outside click can be eaten by a stale event chain.
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKeydown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        top: adjusted?.y ?? menu.position.y,
        left: adjusted?.x ?? menu.position.x,
        // Keep invisible until the layout effect has measured + adjusted
        // — otherwise users see a one-frame flash off-screen.
        visibility: adjusted ? "visible" : "hidden",
      }}
      className="z-50 min-w-[140px] overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
    >
      {menu.items.map((item, idx) => {
        if (item === "divider") {
          return (
            <hr
              key={`divider-${idx}`}
              className="my-1 border-zinc-200 dark:border-zinc-800"
            />
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              if (!item.disabled) item.onClick();
            }}
            className={cn(
              "flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors",
              item.disabled
                ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                : item.danger
                  ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
