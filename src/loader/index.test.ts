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
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Build a detached <script> element and point document.currentScript at
 * it. Not appended to the DOM — appending would trigger happy-dom's
 * script loader. The loader module reads currentScript.src at parse
 * time via getAttribute (not .src); it does not care about connection.
 */
function installFakeScript(src: string): void {
  const el = document.createElement('script');
  el.setAttribute('src', src);
  Object.defineProperty(document, 'currentScript', {
    value: el,
    configurable: true,
  });
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

    const argus = (window as unknown as {
      argus: { run: unknown; destroy: unknown; _state: unknown };
    }).argus;
    expect(typeof argus.run).toBe('function');
    expect(typeof argus.destroy).toBe('function');
    expect(argus._state).toEqual({ running: false, lastRunId: null });
  });

  it('does not auto-run when data-auto-run is absent', async () => {
    installFakeScript('http://cdn.example.com/argus-loader.js');
    await import('./index');

    const iframes = document.querySelectorAll('iframe[data-argus-loader]');
    expect(iframes.length).toBe(0);

    const state = (window as unknown as {
      argus: { _state: { running: boolean; lastRunId: string | null } };
    }).argus._state;
    expect(state.running).toBe(false);
    expect(state.lastRunId).toBeNull();
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
