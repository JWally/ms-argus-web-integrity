/**
 * Canvas 2D Fingerprinting Module
 *
 * Three orthogonal canvas hashes plus a font-width probe. Mirrors
 * FingerprintJS v4 slot s17 with an emoji sub-pass added (per the
 * old-argus-web design — emoji rasterization is GPU-color-font-stack-
 * specific and discriminates Apple Color Emoji vs Segoe UI Emoji vs
 * Noto Color Emoji cleanly).
 *
 * ## What's collected
 *
 * - `winding`     — isPointInPath() winding rule result
 * - `geometry`    — gradient + arcs + shapes rasterized (no text)
 * - `text`        — fillText with Swedish/emoji/Brahmi/Tibetan glyphs
 * - `emoji`       — emoji-only rendering (color font stack)
 * - `fontWidths`  — `measureText('mmmmmmmmmmlli')` per generic family
 *
 * ## Why each sub-hash exists
 *
 * - `geometry` isolates GPU / anti-aliasing behavior (no text = no font
 *    stack dependency).
 * - `text` isolates the font rasterizer (FreeType / DirectWrite /
 *    CoreText) since the geometry is identical across systems.
 * - `emoji` is the color-emoji renderer, which is hardware-accelerated
 *    on a separate code path from monochrome glyph rendering.
 * - `fontWidths` is the Castle `mmmmmmmmmmlli` font-fallback-chain
 *    probe (Castle.md §3.3). Same string per generic family pins down
 *    which actual font is being substituted without enumerating fonts.
 *
 * ## What is NOT computed here
 *
 * - Cross-run delta-stability — server compares two captures (a single
 *   capture can't tell if Brave/Safari RFP injected noise).
 * - Per-OS population check — server has the histogram.
 *
 * @module canvas
 */

import { captureError } from '../errors';
import { hashMini } from '../utils/crypto';
import { createTimer, logTestResult } from '../utils/helpers';
import type { CanvasFingerprint, CanvasProbe } from './types';

// Strings that exercise font rasterization on multiple scripts. Castle
// uses a mix of common-Latin + emoji + rare-script glyphs (Brahmi,
// Burmese, Tibetan); we follow that pattern.
const TEXT_PAYLOAD = [
  'Cwm fjordbank glyphs vext quiz, 😃',
  'Sphinx of black quartz, judge my vow äöå',
  '𑀅 𑀆 𑀇 𑀈 𑀉', // Brahmi
  'ဎ ဍ ဌ ဋ', //   Burmese
  'ༀ ༁ ༂ ༃', //   Tibetan
];

const EMOJI_PAYLOAD = '🗺️😀😁😂😇😉😏👨‍👩‍👧‍👦🇺🇸🏳️‍🌈';

const FONT_PROBE_TEXT = 'mmmmmmmmmmlli';
const GENERIC_FAMILIES = [
  'default',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
];

function makeCanvas(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { canvas, ctx };
  } catch {
    return null;
  }
}

function dataUrlProbe(canvas: HTMLCanvasElement): CanvasProbe {
  try {
    const url = canvas.toDataURL();
    return { hash: hashMini(url), len: url.length };
  } catch {
    return { hash: '', len: 0 };
  }
}

function getWinding(): boolean {
  try {
    const made = makeCanvas(1, 1);
    if (!made) return false;
    const { ctx } = made;
    ctx.rect(0, 0, 10, 10);
    ctx.rect(2, 2, 6, 6);
    return ctx.isPointInPath(5, 5, 'evenodd') === false;
  } catch {
    return false;
  }
}

function getGeometry(): CanvasProbe {
  const made = makeCanvas(280, 60);
  if (!made) return { hash: '', len: 0 };
  const { canvas, ctx } = made;
  try {
    // Gradient + shapes — no text. Captures GPU pixel pipeline
    // without dragging in the font stack.
    const g = ctx.createLinearGradient(0, 0, 280, 60);
    g.addColorStop(0, 'rgba(102,204,0,0.7)');
    g.addColorStop(1, 'rgba(0,102,204,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 280, 60);

    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(255, 0, 102)';
    ctx.arc(100, 30, 25, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = 'rgb(0, 255, 102)';
    ctx.arc(160, 30, 25, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = 'rgb(255, 102, 0)';
    ctx.arc(220, 30, 25, 0, Math.PI * 2, true);
    ctx.fill();

    return dataUrlProbe(canvas);
  } catch {
    return { hash: '', len: 0 };
  }
}

function getText(): CanvasProbe {
  const made = makeCanvas(360, 120);
  if (!made) return { hash: '', len: 0 };
  const { canvas, ctx } = made;
  try {
    ctx.textBaseline = 'top';
    let y = 4;
    for (const line of TEXT_PAYLOAD) {
      ctx.font = `14px 'Arial', sans-serif`;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
      ctx.fillText(line, 4, y);
      y += 20;
    }
    return dataUrlProbe(canvas);
  } catch {
    return { hash: '', len: 0 };
  }
}

function getEmoji(): CanvasProbe {
  const made = makeCanvas(360, 40);
  if (!made) return { hash: '', len: 0 };
  const { canvas, ctx } = made;
  try {
    ctx.textBaseline = 'top';
    ctx.font = '20px Arial';
    ctx.fillText(EMOJI_PAYLOAD, 4, 4);
    return dataUrlProbe(canvas);
  } catch {
    return { hash: '', len: 0 };
  }
}

function getFontWidths(): Record<string, number> {
  const out: Record<string, number> = {};
  const made = makeCanvas(1, 1);
  if (!made) return out;
  const { ctx } = made;
  for (const fam of GENERIC_FAMILIES) {
    try {
      ctx.font = `16px ${fam}`;
      const w = ctx.measureText(FONT_PROBE_TEXT).width;
      out[fam] = Math.round(w * 1000) / 1000;
    } catch {
      out[fam] = 0;
    }
  }
  return out;
}

export default function getCanvas(): CanvasFingerprint | undefined {
  try {
    const timer = createTimer();
    timer.start();

    if (typeof document === 'undefined') {
      return undefined;
    }
    const probe = makeCanvas(1, 1);
    if (!probe) {
      logTestResult({ test: 'canvas', passed: false });
      return {
        contextAvailable: false,
        winding: false,
        geometry: { hash: '', len: 0 },
        text: { hash: '', len: 0 },
        emoji: { hash: '', len: 0 },
        fontWidths: {},
      };
    }

    const winding = getWinding();
    const geometry = getGeometry();
    const text = getText();
    const emoji = getEmoji();
    const fontWidths = getFontWidths();

    logTestResult({ time: timer.stop(), test: 'canvas', passed: true });
    return {
      contextAvailable: true,
      winding,
      geometry,
      text,
      emoji,
      fontWidths,
    };
  } catch (error) {
    logTestResult({ test: 'canvas', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
