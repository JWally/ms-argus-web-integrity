/**
 * Argus Integrity — signal collection orchestrator.
 *
 * Collects bot-detection and integrity signals only.
 * No device fingerprinting (no canvas, audio, fonts, WebGL, etc.)
 */

import getConsoleErrors from './engine';
import { getCapturedErrors } from './errors';
import getCSSKeyCount from './css';
import getHeadlessFeatures from './headless';
import type { HeadlessDetectionInputs } from './headless/types';
import detectIncognito from './incognito';
import getIntl from './intl';
import { getLies, PARENT_PHANTOM } from './lies';
import getMathPrecision from './math';
import getNavigator from './navigator';
import getShielding from './shielding';
import getScreen from './screen';
import { getStatus } from './status';
import getTimezone from './timezone';
import getTimingFingerprint from './timing';
import { getTrash } from './trash';
import getCSSMedia from './cssmedia';
import getWebRTCData from './webrtc';
import getWindowPrefixes from './window';
import getBestWorkerScope from './worker';

export interface IntegrityResult {
  meta: {
    timestamp: number;
    durationMs: number;
  };
  css: ReturnType<typeof getCSSKeyCount>;
  engine: ReturnType<typeof getConsoleErrors>;
  math: ReturnType<typeof getMathPrecision>;
  headless: Awaited<ReturnType<typeof getHeadlessFeatures>>;
  lies: ReturnType<typeof getLies>;
  trash: ReturnType<typeof getTrash>;
  shielding: Awaited<ReturnType<typeof getShielding>>;
  incognito: Awaited<ReturnType<typeof detectIncognito>> | undefined;
  intl: Awaited<ReturnType<typeof getIntl>>;
  navigator: Awaited<ReturnType<typeof getNavigator>>;
  screen: Awaited<ReturnType<typeof getScreen>>;
  status: Awaited<ReturnType<typeof getStatus>> | undefined;
  timezone: Awaited<ReturnType<typeof getTimezone>>;
  timing: Awaited<ReturnType<typeof getTimingFingerprint>>;
  cssMedia: ReturnType<typeof getCSSMedia>;
  webrtc: Awaited<ReturnType<typeof getWebRTCData>> | undefined;
  windowPrefixes: ReturnType<typeof getWindowPrefixes>;
  workerScope: Awaited<ReturnType<typeof getBestWorkerScope>> | null;
  errors: ReturnType<typeof getCapturedErrors>;
}

export async function collectIntegrity(): Promise<IntegrityResult> {
  const start = performance.now();

  // Sync checks — run immediately
  const css = getCSSKeyCount();
  const engine = getConsoleErrors();
  const math = getMathPrecision();
  const cssMedia = getCSSMedia();
  const windowPrefixes = getWindowPrefixes();
  const lies = getLies();
  const trash = getTrash();

  // Spawn worker early for cross-thread validation
  const workerScopePromise = getBestWorkerScope().catch(() => null);

  // Parallel async checks (worker-independent)
  const [
    shielding,
    incognito,
    intl,
    status,
    timezone,
    timing,
    webrtc,
    workerScope,
  ] = await Promise.all([
    getShielding().catch(() => undefined),
    detectIncognito().catch(() => undefined),
    getIntl().catch(() => undefined),
    getStatus().catch(() => undefined),
    getTimezone().catch(() => undefined),
    getTimingFingerprint().catch(() => undefined),
    getWebRTCData().catch(() => undefined),
    workerScopePromise,
  ]);

  const bestScope = (workerScope?.scopes?.[
    workerScope.best as 'shared' | 'web'
  ] ?? {}) as Record<string, unknown>;
  const mainScope = (workerScope?.scopes?.main ?? {}) as Record<
    string,
    unknown
  >;

  // Build headless detection inputs with WebGL data for hasSoftwareRenderer/hasBadWebGL
  const headlessInputs: HeadlessDetectionInputs = {
    webgl: mainScope.webglRenderer
      ? {
          parameters: {
            UNMASKED_RENDERER_WEBGL: mainScope.webglRenderer as string,
          },
        }
      : undefined,
    workerScope: bestScope.userAgent
      ? {
          userAgent: bestScope.userAgent as string,
          webglRenderer: (bestScope.webglRenderer as string) ?? undefined,
        }
      : undefined,
  };

  // Worker-dependent checks
  const [headless, navigatorData, screen] = await Promise.all([
    getHeadlessFeatures(headlessInputs).catch(() => undefined),
    getNavigator(bestScope).catch(() => undefined),
    getScreen().catch(() => undefined),
  ]);

  // Cleanup phantom iframe used by lie detection
  if (PARENT_PHANTOM?.parentNode) {
    PARENT_PHANTOM.parentNode.removeChild(PARENT_PHANTOM);
  }

  return {
    meta: {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - start),
    },
    css,
    engine,
    math,
    headless,
    lies,
    trash,
    shielding,
    incognito,
    intl,
    navigator: navigatorData,
    screen,
    status,
    timezone,
    timing,
    cssMedia,
    webrtc,
    windowPrefixes,
    workerScope,
    errors: getCapturedErrors(),
  };
}
