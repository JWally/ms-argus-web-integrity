/**
 * Argus Integrity — signal collection orchestrator.
 *
 * Collects bot-detection and integrity signals only.
 * No device fingerprinting (no canvas, audio, fonts, WebGL, etc.)
 */

import getConsoleErrors from './engine';
import { getCapturedErrors } from './errors';
import getHeadlessFeatures from './headless';
import detectIncognito from './incognito';
import { analyzeInconsistencies } from './inconsistencies';
import getIntl from './intl';
import { getLies, PARENT_PHANTOM } from './lies';
import getNavigator from './navigator';
import getResistance from './resistance';
import getScreen from './screen';
import { getStatus } from './status';
import getTimezone from './timezone';
import getTimingFingerprint from './timing';
import { getTrash } from './trash';
import getCSSMedia from './cssmedia';
import getWebRTCData from './webrtc';
import getBestWorkerScope, { spawnWorker } from './worker';

export interface IntegrityResult {
  meta: {
    timestamp: number;
    durationMs: number;
  };
  engine: ReturnType<typeof getConsoleErrors>;
  headless: Awaited<ReturnType<typeof getHeadlessFeatures>>;
  lies: ReturnType<typeof getLies>;
  trash: ReturnType<typeof getTrash>;
  resistance: Awaited<ReturnType<typeof getResistance>>;
  inconsistencies: ReturnType<typeof analyzeInconsistencies>;
  incognito: Awaited<ReturnType<typeof detectIncognito>> | undefined;
  intl: Awaited<ReturnType<typeof getIntl>>;
  navigator: Awaited<ReturnType<typeof getNavigator>>;
  screen: Awaited<ReturnType<typeof getScreen>>;
  status: Awaited<ReturnType<typeof getStatus>> | undefined;
  timezone: Awaited<ReturnType<typeof getTimezone>>;
  timing: Awaited<ReturnType<typeof getTimingFingerprint>>;
  cssMedia: ReturnType<typeof getCSSMedia>;
  webrtc: Awaited<ReturnType<typeof getWebRTCData>> | undefined;
  workerScope: Awaited<ReturnType<typeof getBestWorkerScope>> | null;
  errors: ReturnType<typeof getCapturedErrors>;
}

export async function collectIntegrity(): Promise<IntegrityResult> {
  const start = performance.now();

  // Sync checks — run immediately
  const engine = getConsoleErrors();
  const cssMedia = getCSSMedia();
  const lies = getLies();
  const trash = getTrash();

  // Spawn worker early for cross-thread validation
  const workerScopePromise = spawnWorker()
    .then(() => getBestWorkerScope())
    .catch(() => null);

  // Parallel async checks (worker-independent)
  const [
    resistance,
    incognito,
    intl,
    status,
    timezone,
    timing,
    webrtc,
    workerScope,
  ] = await Promise.all([
    getResistance().catch(() => undefined),
    detectIncognito().catch(() => undefined),
    getIntl().catch(() => undefined),
    getStatus().catch(() => undefined),
    getTimezone().catch(() => undefined),
    getTimingFingerprint().catch(() => undefined),
    getWebRTCData().catch(() => undefined),
    workerScopePromise,
  ]);

  const bestScope = (workerScope?.scopes?.[workerScope.best as 'shared' | 'web'] ?? {}) as Record<string, unknown>;

  // Worker-dependent checks
  const [headless, navigatorData, screen] = await Promise.all([
    getHeadlessFeatures({ workerScope: bestScope.userAgent ? { userAgent: bestScope.userAgent as string } : undefined }).catch(() => undefined),
    getNavigator(bestScope).catch(() => undefined),
    getScreen().catch(() => undefined),
  ]);

  // Inconsistencies need the other results to cross-validate
  const inconsistencies = analyzeInconsistencies({
    navigator: navigatorData,
    screen,
    cssMedia,
    timezone,
    intl,
    workerScope: bestScope,
  });

  // Cleanup phantom iframe used by lie detection
  if (PARENT_PHANTOM?.parentNode) {
    PARENT_PHANTOM.parentNode.removeChild(PARENT_PHANTOM);
  }

  return {
    meta: {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - start),
    },
    engine,
    headless,
    lies,
    trash,
    resistance,
    inconsistencies,
    incognito,
    intl,
    navigator: navigatorData,
    screen,
    status,
    timezone,
    timing,
    cssMedia,
    webrtc,
    workerScope,
    errors: getCapturedErrors(),
  };
}
