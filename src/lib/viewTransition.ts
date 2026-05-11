/**
 * Tiny wrapper around the View Transitions API
 * (`document.startViewTransition`). Used to crossfade the editor pane
 * when the user selects a different song / playlist / track map in the
 * sidebar, instead of the hard cut that fell out of React's
 * unmount-and-remount-on-key-change pattern.
 *
 * Behavior:
 *   - On supported browsers (Chromium 111+, Safari 18+ / WebKit
 *     shipping on macOS Sequoia 15.0+), wraps the supplied mutation
 *     in a view-transition: browser screenshots the current DOM,
 *     runs `mutate`, screenshots the new DOM, then crossfades for
 *     ~250ms.
 *   - On unsupported runtimes (older macOS WebKit, etc.) falls back
 *     to a plain synchronous call to `mutate` so the app still works
 *     — just without the crossfade.
 *
 * The mutation runs inside `flushSync` because React batches by
 * default; without it, the post-mutation screenshot would still
 * capture the pre-mutation tree and the crossfade would fade between
 * two identical frames. `flushSync` forces React to commit before
 * `startViewTransition`'s callback returns.
 *
 * Visual scope is controlled by `view-transition-name` CSS on the
 * element(s) we want animated — applied to the editor pane wrapper
 * in `EditorPane.tsx`. Without that, the browser animates the entire
 * document root, which also flashes the sidebar.
 */

import { flushSync } from "react-dom";

export function withViewTransition(mutate: () => void): void {
  // Feature-detect — older WebKit (macOS Sonoma and earlier) doesn't
  // ship the API at all, in which case `startViewTransition` is
  // undefined on the document. Fall through to a plain mutation so
  // the app still works, just without the crossfade.
  if (typeof document.startViewTransition !== "function") {
    mutate();
    return;
  }
  document.startViewTransition(() => {
    flushSync(mutate);
  });
}
