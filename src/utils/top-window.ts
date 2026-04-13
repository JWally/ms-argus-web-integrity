/**
 * Same-origin window traversal.
 *
 * Collection modules run inside the loader's srcdoc iframe, where
 * window-scoped APIs (screen, matchMedia, innerWidth, etc.) may report
 * the iframe's frame size instead of the real device/viewport.
 * WebKit is the offender for screen dims; others may have their own
 * quirks. The fix is to read from the topmost same-origin ancestor,
 * which for our loader is the merchant page.
 *
 * srcdoc iframes inherit the parent's origin, so the walk-up works as
 * long as we don't cross an origin boundary. If the merchant page is
 * itself in a cross-origin frame (rare), we stop at the deepest
 * same-origin ancestor we can reach.
 *
 * Safe to call whether we're inside an iframe or not — if we're already
 * at the top, the loop is a no-op and returns `window`.
 */
export function getTopSameOriginWindow(): Window {
  let w: Window = window;
  try {
    while (w.parent && w.parent !== w) {
      // Touch a property that's cross-origin-restricted to probe the boundary.
      // Throws DOMException if w.parent is a different origin.
      void w.parent.location.href;
      w = w.parent;
    }
  } catch {
    // Hit a cross-origin wall — w is the deepest same-origin ancestor we reached.
  }
  return w;
}
