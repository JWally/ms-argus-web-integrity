/* jscpd:ignore-start */
import getAudio from './audio';
import getCanvas from './canvas';
import getConsoleErrors from './engine';
import { getCapturedErrors } from './errors';
import getCSSKeyCount from './css';
import getFonts from './fonts';
import { hashMini } from './utils/crypto';
import getHeadlessFeatures from './headless';
import type { HeadlessDetectionInputs } from './headless/types';
import getConsoleTiming from './headless/getConsoleTiming';
import getConsoleTimingWorker from './headless/getConsoleTimingWorker';
import getPlatformEstimate from './headless/getPlatformEstimate';
import { getSystemFonts } from './headless/getSystemFonts';
import getWorkerModuleImportChain from './headless/getWorkerModuleImportChain';
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
import type { IntegrityResult } from './integrity';

type Profile = Record<string, number>;

export interface BenchCollectResult {
  result: IntegrityResult;
  profile: Profile;
  wallMs: number;
  payloadBytes: number;
}

export interface HeadlessBenchResult {
  profile: Profile;
  wallMs: number;
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function timeSync<T>(profile: Profile, name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    profile[name] = roundMs(performance.now() - start);
  }
}

async function timeAsync<T>(
  profile: Profile,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    profile[name] = roundMs(performance.now() - start);
  }
}

export async function runBenchCollect(): Promise<BenchCollectResult> {
  const wallStart = performance.now();
  const profile: Profile = {};

  const css = timeSync(profile, 'css', getCSSKeyCount);
  const engine = timeSync(profile, 'engine', getConsoleErrors);
  const math = timeSync(profile, 'math', getMathPrecision);
  const cssMedia = timeSync(profile, 'cssMedia', getCSSMedia);
  const windowPrefixes = timeSync(profile, 'windowPrefixes', getWindowPrefixes);
  const lies = timeSync(profile, 'lies', getLies);
  const trash = timeSync(profile, 'trash', getTrash);
  const canvas = timeSync(profile, 'canvas', getCanvas);
  const fonts = timeSync(profile, 'fonts', getFonts);

  const workerScopePromise = timeAsync(profile, 'workerScope', () =>
    getBestWorkerScope().catch(() => null),
  );

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
    timeAsync(profile, 'shielding', () =>
      getShielding().catch(() => undefined),
    ),
    timeAsync(profile, 'incognito', () =>
      detectIncognito().catch(() => undefined),
    ),
    timeAsync(profile, 'intl', () => getIntl().catch(() => undefined)),
    timeAsync(profile, 'status', () => getStatus().catch(() => undefined)),
    timeAsync(profile, 'timezone', () => getTimezone().catch(() => undefined)),
    timeAsync(profile, 'timing', () =>
      getTimingFingerprint().catch(() => undefined),
    ),
    timeAsync(profile, 'webrtc', () => getWebRTCData().catch(() => undefined)),
    workerScopePromise,
    timeAsync(profile, 'audio', () => getAudio().catch(() => undefined)),
  ]);

  const bestScope = (workerScope?.scopes?.[
    workerScope.best as 'shared' | 'web'
  ] ?? {}) as Record<string, unknown>;
  const mainScope = (workerScope?.scopes?.main ?? {}) as Record<
    string,
    unknown
  >;

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

  const [headless, navigatorData, screen] = await Promise.all([
    timeAsync(profile, 'headless', () =>
      getHeadlessFeatures(headlessInputs).catch(() => undefined),
    ),
    timeAsync(profile, 'navigator', () =>
      getNavigator(bestScope).catch(() => undefined),
    ),
    timeAsync(profile, 'screen', () => getScreen().catch(() => undefined)),
  ]);

  if (PARENT_PHANTOM?.parentNode) {
    PARENT_PHANTOM.parentNode.removeChild(PARENT_PHANTOM);
  }

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

  const result: IntegrityResult = {
    meta: {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - wallStart),
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
  const payloadJson = JSON.stringify(result);
  return {
    result,
    profile,
    wallMs: performance.now() - wallStart,
    payloadBytes: new TextEncoder().encode(payloadJson).length,
  };
}

export async function runHeadlessBench(): Promise<HeadlessBenchResult> {
  const wallStart = performance.now();
  const profile: Profile = {};
  timeSync(profile, 'systemFonts', getSystemFonts);
  timeSync(profile, 'platformEstimate', getPlatformEstimate);
  await Promise.all([
    timeAsync(profile, 'consoleTimingWorker', () =>
      getConsoleTimingWorker().catch(() => undefined),
    ),
    timeAsync(profile, 'workerModuleImportChain', () =>
      getWorkerModuleImportChain().catch(() => undefined),
    ),
    timeAsync(profile, 'consoleTimingIframe', async () => getConsoleTiming()),
  ]);
  return {
    profile,
    wallMs: performance.now() - wallStart,
  };
}
/* jscpd:ignore-end */
