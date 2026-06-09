import { join } from 'node:path';
import { homedir } from 'node:os';

import { test, expect } from '@playwright/test';
import {
  findVenvPython,
  runPythonBrowserRunner,
  fetchAdversarialRecord,
} from './helpers';

/**
 * Camoufox — a Firefox/Marionette anti-detect fork. It can't be imported
 * into this Playwright suite (Python-only, lives in ms-argus-bots), so we
 * shell out to runners/camoufox-runner.py.
 *
 * Detection path: iframe-crypto. Marionette orphans the WebCrypto keygen
 * completion inside a closed-shadow double-nested iframe — the promise
 * never resolves (responsive=false) while real browsers finish in ~30ms.
 * This is surface-impossible to evade at the JS level.
 */
const PY = findVenvPython([
  join(homedir(), 'Dev/ms-argus-bots/venv/bin/python'),
  join(homedir(), 'Dev/ms-argus-bots/.venv/bin/python'),
]);
const RUNNER = join(
  process.cwd(),
  'e2e/adversarial/runners/camoufox-runner.py',
);

test.describe('adversarial: camoufox', () => {
  test.skip(
    !PY,
    'camoufox venv not found (expected ~/Dev/ms-argus-bots/venv)',
  );

  test('detects camoufox via Marionette iframe-crypto stall', async () => {
    const sessionId = runPythonBrowserRunner(PY as string, RUNNER);
    const record = await fetchAdversarialRecord(sessionId);

    const dev = (record.device ?? {}) as Record<string, unknown>;
    const status = (dev.status ?? {}) as {
      iframeCrypto?: {
        responsive?: boolean;
        iframe_created?: boolean;
        elapsed_ms?: number | null;
      };
    };
    const ic = status.iframeCrypto ?? {};
    const lies = (dev.lies ?? {}) as { totalLies?: number };

    console.log('Camoufox result:', {
      sessionId,
      iframeCrypto: ic,
      totalLies: lies.totalLies,
    });

    expect(sessionId, 'Should get a session ID').toBeTruthy();

    // Marionette signature: iframe was constructed but the keygen promise
    // never resolved. iframe_created=true && responsive=false.
    expect(
      ic.iframe_created === true && ic.responsive === false,
      `Camoufox should trip iframe-crypto (Marionette stall). ` +
        `got ${JSON.stringify(ic)}, lies=${lies.totalLies}`,
    ).toBe(true);
  });
});
