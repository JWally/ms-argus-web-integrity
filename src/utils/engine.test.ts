import { describe, it, expect } from 'vitest';
import { ENGINE_IDENTIFIER, IS_BLINK, IS_GECKO, IS_WEBKIT, JS_ENGINE } from './engine';
import { EngineId } from '../constants/engine';

describe('engine detection', () => {
  it('returns exactly one engine flag set to true', () => {
    const flags = [IS_BLINK, IS_GECKO, IS_WEBKIT];
    const trueCount = flags.filter(Boolean).length;

    expect(
      trueCount,
      // If this fires, the (-1).toFixed(-1) error-message trick in
      // utils/engine.ts::getEngine() no longer produces one of the
      // magic numbers in constants/engine.ts::EngineId. That means
      // IS_BLINK / IS_GECKO / IS_WEBKIT all return false across our
      // entire codebase, silently breaking any downstream check gated
      // on them (headless signals, Brave detection, worker module
      // feature flags). Fix: measure getEngine() in the current
      // browser, update the corresponding EngineId constant.
    ).toBe(1);
  });

  it('ENGINE_IDENTIFIER matches one of the known EngineId values', () => {
    expect([
      EngineId.V8_BLINK,
      EngineId.SPIDERMONKEY_GECKO,
      EngineId.JAVASCRIPTCORE_WEBKIT,
    ]).toContain(ENGINE_IDENTIFIER);
  });

  it('JS_ENGINE is non-null when a known engine is detected', () => {
    expect(JS_ENGINE).not.toBeNull();
    expect(typeof JS_ENGINE).toBe('string');
  });

  it('detected engine name matches the active flag', () => {
    if (IS_BLINK) expect(JS_ENGINE).toBe('V8');
    if (IS_GECKO) expect(JS_ENGINE).toBe('SpiderMonkey');
    if (IS_WEBKIT) expect(JS_ENGINE).toBe('JavaScriptCore');
  });
});
