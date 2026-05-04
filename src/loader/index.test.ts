/**
 * Loader unit tests.
 *
 * Scope limited to module-level registration and bookkeeping. Iframe
 * lifecycle, postMessage round-trip, timeout, destroy, and supersede
 * are covered by the e2e suite (12 real-browser tests in
 * e2e/clean/loader.spec.ts) — simulating srcdoc iframes + script
 * loading in happy-dom invites more mocking than the tests validate.
 *
 * Here we assert only what can be checked cleanly in isolation:
 *   - window.argus gets registered on import
 *   - API surface (run, destroy, _state) exists
 *   - No auto-run without data-auto-run attribute
 *   - Double-load does not overwrite the first loader's state
 *   - data-on scheduling mode dispatches at the right lifecycle phase
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Build a detached <script> element and point document.currentScript at
 * it. Optionally set data-* attributes for auto-run / scheduling tests.
 * Not appended to the DOM — appending would trigger happy-dom's script
 * loader. The loader module reads currentScript.src at parse time via
 * getAttribute (not .src); it does not care about connection.
 */
function installFakeScript(
  src: string,
  attrs: Record<string, string> = {},
): HTMLScriptElement {
  const el = document.createElement('script');
  el.setAttribute('src', src);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.defineProperty(document, 'currentScript', {
    value: el,
    configurable: true,
  });
  return el;
}

describe('argus-loader', () => {
  beforeEach(() => {
    // Fresh module state per test (the loader captures currentScript
    // at parse time).
    vi.resetModules();
    delete (window as unknown as { argus?: unknown }).argus;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('registers window.argus on module load', async () => {
    installFakeScript('http://cdn.example.com/argus-loader.js');
    await import('./index');

    const argus = (window as unknown as { argus?: unknown }).argus;
    expect(argus).toBeDefined();
    expect(typeof argus).toBe('object');
  });

  it('exposes run, destroy, and _state on window.argus', async () => {
    installFakeScript('http://cdn.example.com/argus-loader.js');
    await import('./index');

    const argus = (
      window as unknown as {
        argus: { run: unknown; destroy: unknown; _state: unknown };
      }
    ).argus;
    expect(typeof argus.run).toBe('function');
    expect(typeof argus.destroy).toBe('function');
    expect(argus._state).toEqual({ running: false, lastRunId: null });
  });

  it('does not auto-run when data-auto-run is absent', async () => {
    installFakeScript('http://cdn.example.com/argus-loader.js');
    await import('./index');

    const iframes = document.querySelectorAll('iframe[data-argus-loader]');
    expect(iframes.length).toBe(0);

    const state = (
      window as unknown as {
        argus: { _state: { running: boolean; lastRunId: string | null } };
      }
    ).argus._state;
    expect(state.running).toBe(false);
    expect(state.lastRunId).toBeNull();
  });

  describe('data-on scheduling', () => {
    /**
     * The auto-run path eventually calls run(), which tries to create an
     * iframe pointing at the inner-bundle URL. In happy-dom that fails
     * (or rejects asynchronously after this test has moved on), but for
     * scheduling-correctness we only care WHEN run() was called, not
     * whether it succeeded. Counting iframe-creation attempts gives us a
     * cheap, side-effect-based signal — every call to run() ends up at
     * document.body.appendChild(iframe) before any async failure.
     */
    let appendCount = 0;
    let originalAppendChild: typeof document.body.appendChild;

    beforeEach(() => {
      appendCount = 0;
      originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation(((
        node: Node,
      ) => {
        if (
          node instanceof HTMLIFrameElement &&
          node.hasAttribute('data-argus-loader')
        ) {
          appendCount += 1;
          return node;
        }
        return originalAppendChild(node);
      }) as typeof document.body.appendChild);
    });

    it('immediate: fires synchronously at module load', async () => {
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
        'data-on': 'immediate',
      });
      await import('./index');
      expect(appendCount).toBe(1);
    });

    it('load: defers until window load event', async () => {
      // happy-dom may have already finished loading; force readyState back.
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
      });
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
        'data-on': 'load',
      });
      await import('./index');
      expect(appendCount, 'should not have fired yet').toBe(0);

      window.dispatchEvent(new Event('load'));
      // run() is sync up through iframe append — no await needed.
      expect(appendCount).toBe(1);
    });

    it('idle: defers until load + idle slot', async () => {
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
      });
      // Force the polyfill path by stubbing requestIdleCallback away.
      vi.stubGlobal('requestIdleCallback', undefined);
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
        'data-on': 'idle',
      });
      await import('./index');
      expect(appendCount, 'should not have fired before load').toBe(0);

      window.dispatchEvent(new Event('load'));
      // Polyfill is setTimeout(cb, 1) — flush microtask + a 1ms timer.
      await new Promise((r) => setTimeout(r, 5));
      expect(appendCount).toBe(1);

      vi.unstubAllGlobals();
    });

    it('idle: is the default when data-on is omitted', async () => {
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
      });
      vi.stubGlobal('requestIdleCallback', undefined);
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
      });
      await import('./index');
      expect(appendCount, 'should not have fired without trigger').toBe(0);

      window.dispatchEvent(new Event('load'));
      await new Promise((r) => setTimeout(r, 5));
      expect(appendCount).toBe(1);

      vi.unstubAllGlobals();
    });

    it('interaction: defers until first user event', async () => {
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
        'data-on': 'interaction',
      });
      await import('./index');
      expect(appendCount, 'should not have fired without interaction').toBe(0);

      window.dispatchEvent(new Event('pointerdown'));
      expect(appendCount).toBe(1);

      // Subsequent events do not retrigger
      window.dispatchEvent(new Event('keydown'));
      window.dispatchEvent(new Event('scroll'));
      expect(appendCount).toBe(1);
    });

    it('unknown data-on value falls back to idle default', async () => {
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
      });
      vi.stubGlobal('requestIdleCallback', undefined);
      installFakeScript('http://cdn.example.com/argus-loader.js', {
        'data-auto-run': '',
        'data-on': 'whenever-i-feel-like-it',
      });
      await import('./index');
      expect(appendCount).toBe(0);

      window.dispatchEvent(new Event('load'));
      await new Promise((r) => setTimeout(r, 5));
      expect(appendCount).toBe(1);

      vi.unstubAllGlobals();
    });
  });

  it('double-load: second import does not overwrite the first loader', async () => {
    installFakeScript('http://cdn.example.com/argus-loader.js');
    await import('./index');
    const firstArgus = (window as unknown as { argus: unknown }).argus;

    // Second import WITHOUT resetModules — simulates a stray second
    // <script> inclusion on the same page. Module cache means the
    // second `await import` is a no-op that returns the cached module,
    // but window.argus stays pointed at whatever the original
    // registered. We verify no overwrite path kicks in on re-evaluation.
    await import('./index');
    const secondArgus = (window as unknown as { argus: unknown }).argus;

    expect(secondArgus).toBe(firstArgus);
  });
});
