/**
 * Phantom Darkness - Isolated iFrame Testing
 *
 * Creates isolated iframe contexts for API testing. Extensions often only
 * hook the main window's APIs. By creating nested iframes (phantom darkness),
 * we can access APIs that may not be modified, allowing detection of tampering.
 *
 * @module lies/phantom
 */

import { captureError } from '../errors';
import { IS_BLINK, IS_WORKER_SCOPE } from '../utils/helpers';
import { GHOST_STYLES } from './constants';
import { getRandomValues } from './error-traps';
import type { PhantomIframe } from './types';

/**
 * DOM context interface for dependency injection (testing).
 */
export interface DOMContext {
  document: Document;
  self: Window & typeof globalThis;
}

/**
 * Default DOM context using actual browser globals.
 */
export const defaultDOMContext: DOMContext = {
  document: typeof document !== 'undefined' ? document : ({} as Document),
  self: typeof self !== 'undefined' ? self : ({} as Window & typeof globalThis),
};

/**
 * Creates a deeply nested iframe for isolated API testing ("Behemoth").
 *
 * Extensions often only hook the main window. By creating a nested iframe
 * (iframe inside iframe), we can access APIs that may not be modified.
 * This is called "Behemoth" because it's a larger, more isolated context.
 *
 * Only used in Blink browsers where this technique is most effective.
 *
 * @param win - Parent window to create iframe in
 * @returns ContentWindow of the nested iframe, or original window on failure
 */
export function getBehemothIframe(win: Window): Window | null {
  try {
    if (!IS_BLINK) return win;

    const div = win.document.createElement('div');
    div.setAttribute('id', getRandomValues());
    div.setAttribute('style', GHOST_STYLES);
    div.innerHTML = `<div><iframe></iframe></div>`;
    win.document.body.appendChild(div);
    const iframe = [
      ...[...div.childNodes][0].childNodes,
    ][0] as HTMLIFrameElement;

    if (!iframe) return null;

    const { contentWindow } = iframe || {};
    if (!contentWindow) return null;

    // Create another nested iframe for even more isolation
    const div2 = contentWindow.document.createElement('div');
    div2.innerHTML = `<div><iframe></iframe></div>`;
    contentWindow.document.body.appendChild(div2);
    const iframe2 = [
      ...[...div2.childNodes][0].childNodes,
    ][0] as HTMLIFrameElement;
    return iframe2.contentWindow;
  } catch (error) {
    captureError(error as Error, 'client blocked behemoth iframe');
    return win;
  }
}

/**
 * Creates a phantom iframe for isolated API testing using closed Shadow DOM.
 *
 * The "phantom" is an invisible iframe hidden inside a closed shadow root,
 * making it much harder for extensions/bots to detect or interfere with.
 * Extensions that modify the main window's APIs may not modify iframe APIs,
 * allowing detection.
 *
 * @param domContext - Optional DOM context for testing
 * @returns Object with iframe window reference and parent div for cleanup
 */
export function getPhantomIframe(
  domContext: DOMContext = defaultDOMContext,
): PhantomIframe {
  if (IS_WORKER_SCOPE) {
    return { iframeWindow: domContext.self };
  }

  try {
    const { document: doc, self: win } = domContext;
    const numberOfIframes = win.length;

    // Plain DOM approach (matches CreepJS) — closed Shadow DOM creates a
    // cross-realm context that causes Function.toString to fail in Blink,
    // which cascades into detectProxies=true and 278 false-positive lies.
    const div = doc.createElement('div');
    div.setAttribute('id', getRandomValues());
    div.setAttribute('style', GHOST_STYLES);
    div.innerHTML = `<div><iframe></iframe></div>`;
    doc.body.appendChild(div);

    const iframeWindow = win[numberOfIframes];
    const phantomWindow = iframeWindow
      ? getBehemothIframe(iframeWindow)
      : null;

    return {
      iframeWindow: (phantomWindow || iframeWindow || win) as Window &
        typeof globalThis,
      div,
    };
  } catch (error) {
    captureError(error as Error, 'client blocked phantom iframe');
    return { iframeWindow: domContext.self };
  }
}

/**
 * Initialize phantom iframe on module load (browser only).
 */
let PHANTOM_DARKNESS: Window & typeof globalThis;
let PARENT_PHANTOM: HTMLDivElement | undefined;

// Only initialize in browser context
if (typeof document !== 'undefined') {
  const phantom = getPhantomIframe();
  PHANTOM_DARKNESS = phantom.iframeWindow;
  PARENT_PHANTOM = phantom.div;
}

export { PHANTOM_DARKNESS, PARENT_PHANTOM };
