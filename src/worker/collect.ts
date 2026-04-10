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
  const date = d.getDate(), month = d.getMonth(), year = d.getFullYear();
  const fmt = (n: number) => String(n).padStart(2, '0');
  const dateStr = (month + 1) + '/' + fmt(date) + '/' + year;
  const utcStr = year + '-' + fmt(month + 1) + '-' + fmt(date);
  return Math.round((Date.parse(new Date(dateStr).toString()) - new Date(utcStr).getTime()) / 60000);
}

/**
 * Detects locale from multiple Intl constructors. Returns deduplicated list as string.
 */
export function getLocaleString(): string {
  const ctors = ['Collator', 'DateTimeFormat', 'DisplayNames', 'ListFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat'] as const;
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
      style: 'currency', currency: 'USD', currencyDisplay: 'name',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch {}
  const engineCurrencyLocale = (1).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', currencyDisplay: 'name',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  return { systemCurrencyLocale, engineCurrencyLocale };
}

/**
 * Gets WebGL1/2 vendor and renderer strings via canvas elements.
 * Uses document.createElement (main thread) instead of OffscreenCanvas (workers).
 */
export function getMainWebgl(): {
  webglRenderer?: string; webglVendor?: string;
  webgl2Renderer?: string; webgl2Vendor?: string;
} {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gl2 = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    const ext2 = gl2 && gl2.getExtension('WEBGL_debug_renderer_info');
    return {
      webglRenderer: ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
      webglVendor: ext ? gl!.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
      webgl2Renderer: ext2 ? gl2!.getParameter(ext2.UNMASKED_RENDERER_WEBGL) : undefined,
      webgl2Vendor: ext2 ? gl2!.getParameter(ext2.UNMASKED_VENDOR_WEBGL) : undefined,
    };
  } catch { return {}; }
}
