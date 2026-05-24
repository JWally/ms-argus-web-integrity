/**
 * Argus Integrity — signal collection orchestrator.
 *
 * Collects bot-detection AND device-fingerprinting signals. The latter
 * (canvas, audio, fonts) was added in the FPJS-parity refactor (see
 * `~/Dev/FPJS-TO-ARGUS.md` §8.1) so server-side analyzers can build
 * per-OS / per-browser-version population baselines and detect
 * cross-signal contradictions (e.g. UA claims Mac but canvas hash is
 * Linux-Mesa-shaped).
 */

import getAudio from './audio';
import getCanvas from './canvas';
import getConsoleErrors from './engine';
import { getCapturedErrors } from './errors';
import getCSSKeyCount from './css';
import getFonts from './fonts';
import { hashMini } from './utils/crypto';
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
    /**
     * Composite device-stability hash (DataDome `bchk` pattern).
     * Deterministic 32-char hashMini over a fixed subset of
     * high-stability signals: canvas hashes (geometry+text+emoji),
     * audio sampleSum (rounded to dampen Safari noise), WebGL
     * renderer string, navigator.platform, hardwareConcurrency,
     * deviceMemory, font genericWidths. Same machine, same browser,
     * same OS → same hash across runs, sessions, and clean/blocked
     * verdicts. Lets merchants rate-limit on one ID without
     * reconstructing manually.
     */
    compositeHash: string;
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
  /** Canvas 2D fingerprint (fpjs s17 + emoji + font-width vector) */
  canvas: ReturnType<typeof getCanvas>;
  /** Web Audio fingerprint (fpjs s21 sum + NODE-CONSTANTS dict) */
  audio: Awaited<ReturnType<typeof getAudio>> | undefined;
  /** Fonts fingerprint (fpjs s20 + s51 — installed + generic metrics) */
  fonts: ReturnType<typeof getFonts>;
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
  const canvas = getCanvas();
  const fonts = getFonts();

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
    audio,
  ] = await Promise.all([
    getShielding().catch(() => undefined),
    detectIncognito().catch(() => undefined),
    getIntl().catch(() => undefined),
    getStatus().catch(() => undefined),
    getTimezone().catch(() => undefined),
    getTimingFingerprint().catch(() => undefined),
    getWebRTCData().catch(() => undefined),
    workerScopePromise,
    getAudio().catch(() => undefined),
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

  // Composite device-stability hash (DataDome `bchk` pattern). Only
  // includes signals that DON'T drift session-to-session on the same
  // hardware. Excluded: timestamps, jitter, error counts, anything
  // randomized per-page. Audio sum is bucketed to 1 decimal place
  // to absorb Safari's per-session noise injection while still
  // discriminating different hardware.
  const compositeHash = hashMini({
    canvasGeometry: canvas?.geometry?.hash ?? '',
    canvasText: canvas?.text?.hash ?? '',
    canvasEmoji: canvas?.emoji?.hash ?? '',
    audioBucket:
      audio?.sampleSum != null && Number.isFinite(audio.sampleSum)
        ? Math.round(audio.sampleSum * 10) / 10
        : null,
    webglRenderer:
      (workerScope?.scopes?.main as { webglRenderer?: string } | undefined)
        ?.webglRenderer ?? null,
    platform:
      (navigatorData as { platform?: string } | undefined)?.platform ?? null,
    hardwareConcurrency:
      (navigatorData as { hardwareConcurrency?: number } | undefined)
        ?.hardwareConcurrency ?? null,
    deviceMemory:
      (navigatorData as { deviceMemory?: number } | undefined)?.deviceMemory ??
      null,
    fontWidths: fonts?.genericWidths ?? null,
    audioConstantsCount: audio?.nodeConstants
      ? Object.keys(audio.nodeConstants).length
      : 0,
  });

  return {
    meta: {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - start),
      compositeHash,
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
    canvas,
    audio,
    fonts,
  };
}
