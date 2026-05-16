/**
 * Main-thread data collection functions.
 *
 * These mirror the logic in INLINE_WORKER_SCRIPT (index.ts) which runs
 * inside Blob workers. Changes here may need manual sync to the inline
 * script string, and vice versa.
 */

/**
 * Computes timezone offset in minutes by comparing local/UTC date parsing.
 */
export function computeTimezoneOffset(): number {
  const d = new Date();
  const date = d.getDate(),
    month = d.getMonth(),
    year = d.getFullYear();
  const fmt = (n: number) => String(n).padStart(2, '0');
  const dateStr = month + 1 + '/' + fmt(date) + '/' + year;
  const utcStr = year + '-' + fmt(month + 1) + '-' + fmt(date);
  return Math.round(
    (Date.parse(new Date(dateStr).toString()) - new Date(utcStr).getTime()) /
      60000,
  );
}

/**
 * Detects locale from multiple Intl constructors. Returns deduplicated list as string.
 */
export function getLocaleString(): string {
  const ctors = [
    'Collator',
    'DateTimeFormat',
    'DisplayNames',
    'ListFormat',
    'NumberFormat',
    'PluralRules',
    'RelativeTimeFormat',
  ] as const;
  const locales = ctors.reduce<string[]>((acc, name) => {
    try {
      const obj = new (Intl as any)[name]();
      if (obj) acc.push(obj.resolvedOptions().locale);
    } catch {}
    return acc;
  }, []);
  return String([...new Set(locales)]);
}

/**
 * Currency locale detection for entropy validation.
 */
export function getCurrencyLocales(language: string): {
  systemCurrencyLocale: string | undefined;
  engineCurrencyLocale: string;
} {
  const lang = String(language).split(',')[0];
  let systemCurrencyLocale: string | undefined;
  try {
    systemCurrencyLocale = (1).toLocaleString(lang || undefined, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'name',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {}
  const engineCurrencyLocale = (1).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'name',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return { systemCurrencyLocale, engineCurrencyLocale };
}

/**
 * Gets WebGL1/2 vendor and renderer strings via canvas elements.
 * Uses document.createElement (main thread) instead of OffscreenCanvas (workers).
 */
export function getMainWebgl(): {
  webglRenderer?: string;
  webglVendor?: string;
  webgl2Renderer?: string;
  webgl2Vendor?: string;
} {
  try {
    const gl = document
      .createElement('canvas')
      .getContext('webgl') as WebGLRenderingContext | null;
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gl2 = document
      .createElement('canvas')
      .getContext('webgl2') as WebGL2RenderingContext | null;
    const ext2 = gl2 && gl2.getExtension('WEBGL_debug_renderer_info');
    return {
      webglRenderer: ext
        ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : undefined,
      webglVendor: ext
        ? gl!.getParameter(ext.UNMASKED_VENDOR_WEBGL)
        : undefined,
      webgl2Renderer: ext2
        ? gl2!.getParameter(ext2.UNMASKED_RENDERER_WEBGL)
        : undefined,
      webgl2Vendor: ext2
        ? gl2!.getParameter(ext2.UNMASKED_VENDOR_WEBGL)
        : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Gets NetworkInformation from navigator.connection (main thread).
 */
export function getConnection(): {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
} | null {
  try {
    const c = (navigator as any).connection;
    if (!c) return null;
    return {
      downlink: c.downlink,
      effectiveType: c.effectiveType,
      rtt: c.rtt,
      saveData: c.saveData,
    };
  } catch {
    return null;
  }
}

/**
 * Queries permission states for cross-validation with worker scope.
 */
export async function getPermissions(): Promise<Record<string, string> | null> {
  try {
    if (!navigator.permissions) return null;
    const names = [
      'notifications',
      'push',
      'persistent-storage',
      'screen-wake-lock',
    ] as const;
    const results: Record<string, string> = {};
    for (const name of names) {
      try {
        results[name] = (
          await navigator.permissions.query({ name: name as PermissionName })
        ).state;
      } catch {}
    }
    return results;
  } catch {
    return null;
  }
}

/**
 * Gets storage quota estimate for cross-validation.
 */
export async function getStorageEstimate(): Promise<{
  quota?: number;
  usage?: number;
} | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { quota, usage } = await navigator.storage.estimate();
    return { quota, usage };
  } catch {
    return null;
  }
}

/**
 * Probes media decoding capabilities for fingerprinting. The codec matrix
 * mirrors FPJS v4's 11-entry probe set (FPJS.md §4.6) plus AAC for further
 * licensing-fragmentation entropy. The `powerEfficient` flag in each result
 * surfaces hardware-decode availability — stable per (GPU, OS) and very hard
 * to fake in headless / VM environments.
 *
 * Keys include resolution (or channels) so multiple configs of the same codec
 * (e.g. VP9 1080p30 vs 4K60) don't collide.
 */
export async function getMediaCapabilities(): Promise<Record<
  string,
  { supported: boolean; smooth: boolean; powerEfficient: boolean }
> | null> {
  try {
    if (!(navigator as any).mediaCapabilities) return null;
    const configs = [
      // VP8 1080p30 (legacy webm, broad support)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/webm; codecs="vp8"',
          width: 1920,
          height: 1080,
          bitrate: 2000000,
          framerate: 30,
        },
      },
      // VP9 1080p30 (current webm)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/webm; codecs="vp9"',
          width: 1920,
          height: 1080,
          bitrate: 2000000,
          framerate: 30,
        },
      },
      // VP9 4K60 high-bitrate (hardware-decode discriminator)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/webm; codecs="vp9"',
          width: 3840,
          height: 2160,
          bitrate: 30000000,
          framerate: 60,
        },
      },
      // H.264 baseline 1080p30 (broadest profile)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1920,
          height: 1080,
          bitrate: 2000000,
          framerate: 30,
        },
      },
      // H.264 high 1080p30 (Chromium-with-proprietary vs open Chromium)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="avc1.640028"',
          width: 1920,
          height: 1080,
          bitrate: 6000000,
          framerate: 30,
        },
      },
      // HEVC main 1080p30 (Mac/Win OS-licensed; Linux often missing)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="hev1.1.6.L93.B0"',
          width: 1920,
          height: 1080,
          bitrate: 2000000,
          framerate: 30,
        },
      },
      // HEVC main10 4K60 (HDR; Apple Silicon / recent Win HW)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="hvc1.2.4.L120.B0"',
          width: 3840,
          height: 2160,
          bitrate: 30000000,
          framerate: 60,
        },
      },
      // AV1 main 1080p30 (modern silicon: M3+, Intel 11th-gen+, Zen3+)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="av01.0.05M.08"',
          width: 1920,
          height: 1080,
          bitrate: 2000000,
          framerate: 30,
        },
      },
      // AV1 4K60 (very recent silicon)
      {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="av01.0.13M.08"',
          width: 3840,
          height: 2160,
          bitrate: 30000000,
          framerate: 60,
        },
      },
      // Opus stereo 48k (existing webm baseline)
      {
        type: 'file' as const,
        audio: {
          contentType: 'audio/webm; codecs="opus"',
          channels: 2,
          bitrate: 128000,
          samplerate: 48000,
        },
      },
      // Opus 5.1 high-bitrate (mobile fragmented)
      {
        type: 'file' as const,
        audio: {
          contentType: 'audio/webm; codecs="opus"',
          channels: 6,
          bitrate: 510000,
          samplerate: 48000,
        },
      },
      // AAC LC stereo 44.1k (OS-licensed; Linux often missing)
      {
        type: 'file' as const,
        audio: {
          contentType: 'audio/mp4; codecs="mp4a.40.2"',
          channels: 2,
          bitrate: 128000,
          samplerate: 44100,
        },
      },
    ];
    const results: Record<
      string,
      { supported: boolean; smooth: boolean; powerEfficient: boolean }
    > = {};
    for (const cfg of configs) {
      try {
        const key = cfg.video
          ? `${cfg.video.contentType} @ ${cfg.video.width}x${cfg.video.height}/${cfg.video.framerate}fps`
          : `${cfg.audio!.contentType} @ ${cfg.audio!.channels}ch/${cfg.audio!.samplerate}Hz`;
        const r = await (navigator as any).mediaCapabilities.decodingInfo(cfg);
        results[key] = {
          supported: r.supported,
          smooth: r.smooth,
          powerEfficient: r.powerEfficient,
        };
      } catch {}
    }
    return results;
  } catch {
    return null;
  }
}
