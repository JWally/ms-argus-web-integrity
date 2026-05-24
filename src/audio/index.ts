/**
 * Web Audio Fingerprinting Module
 *
 * Two complementary fingerprints:
 *
 * 1. **sampleSum** (FingerprintJS s21 equivalent): Renders a fixed
 *    audio graph (oscillator → dynamics-compressor) via
 *    `OfflineAudioContext.startRendering`, sums the absolute values of
 *    a sample window. The result varies with the underlying DSP code
 *    paths (SIMD intrinsics, libm transcendental quirks). Discriminates
 *    CPU+OS combinations cleanly EXCEPT on Safari, which deliberately
 *    injects per-session noise into rendered samples to defeat
 *    fingerprinting. On Safari, this signal collapses.
 *
 * 2. **nodeConstants**: A dictionary of ~45 declarative AudioParam
 *    properties read directly from the audio node classes
 *    (AnalyserNode, DynamicsCompressorNode, OscillatorNode, …). These
 *    are ENGINE CONSTANTS declared in the browser's C++ — not values
 *    computed from rendered audio. Safari's output-noise injection
 *    perturbs buffers, not configuration, so this signal STAYS STABLE
 *    on Safari. Excellent device-identification material:
 *
 *      - Stable across sessions on the same browser+version
 *      - Discriminates browser engine and version
 *      - Survives canvas/audio noise injection
 *      - Free to collect (no rendering required)
 *
 * Without `nodeConstants`, Safari users would be invisible to audio
 * fingerprinting. With it, they're identifiable via engine constants.
 *
 * @module audio
 */

import { captureError } from '../errors';
import { createTimer, logTestResult } from '../utils/helpers';
import type { AudioFingerprint } from './types';

// ── nodeConstants probe — declarative AudioParam properties ───────────
//
// Each tuple: [outputKey, factory, paramPath].
// `factory` must return an instance of the node class (we use a
// temporary context to instantiate). `paramPath` is the dotted path
// inside the instance to the AudioParam (or scalar) we read.
//
// Reading .defaultValue / .minValue / .maxValue on AudioParam
// instances doesn't invoke the DSP engine — it reads C++ constants.
type ConstProbe = [
  string,
  (ctx: AudioContext | OfflineAudioContext) => AudioNode,
  string,
];

function buildConstantProbes(): ConstProbe[] {
  return [
    // AnalyserNode
    ['analyser.channelCount', (c) => c.createAnalyser(), 'channelCount'],
    [
      'analyser.channelCountMode',
      (c) => c.createAnalyser(),
      'channelCountMode',
    ],
    [
      'analyser.channelInterpretation',
      (c) => c.createAnalyser(),
      'channelInterpretation',
    ],
    ['analyser.fftSize', (c) => c.createAnalyser(), 'fftSize'],
    [
      'analyser.frequencyBinCount',
      (c) => c.createAnalyser(),
      'frequencyBinCount',
    ],
    ['analyser.maxDecibels', (c) => c.createAnalyser(), 'maxDecibels'],
    ['analyser.minDecibels', (c) => c.createAnalyser(), 'minDecibels'],
    [
      'analyser.smoothingTimeConstant',
      (c) => c.createAnalyser(),
      'smoothingTimeConstant',
    ],
    ['analyser.numberOfInputs', (c) => c.createAnalyser(), 'numberOfInputs'],
    ['analyser.numberOfOutputs', (c) => c.createAnalyser(), 'numberOfOutputs'],

    // DynamicsCompressorNode — heavy fingerprint surface
    [
      'compressor.attack.defaultValue',
      (c) => c.createDynamicsCompressor(),
      'attack.defaultValue',
    ],
    [
      'compressor.attack.minValue',
      (c) => c.createDynamicsCompressor(),
      'attack.minValue',
    ],
    [
      'compressor.attack.maxValue',
      (c) => c.createDynamicsCompressor(),
      'attack.maxValue',
    ],
    [
      'compressor.knee.defaultValue',
      (c) => c.createDynamicsCompressor(),
      'knee.defaultValue',
    ],
    [
      'compressor.knee.minValue',
      (c) => c.createDynamicsCompressor(),
      'knee.minValue',
    ],
    [
      'compressor.knee.maxValue',
      (c) => c.createDynamicsCompressor(),
      'knee.maxValue',
    ],
    [
      'compressor.ratio.defaultValue',
      (c) => c.createDynamicsCompressor(),
      'ratio.defaultValue',
    ],
    [
      'compressor.ratio.minValue',
      (c) => c.createDynamicsCompressor(),
      'ratio.minValue',
    ],
    [
      'compressor.ratio.maxValue',
      (c) => c.createDynamicsCompressor(),
      'ratio.maxValue',
    ],
    [
      'compressor.release.defaultValue',
      (c) => c.createDynamicsCompressor(),
      'release.defaultValue',
    ],
    [
      'compressor.release.minValue',
      (c) => c.createDynamicsCompressor(),
      'release.minValue',
    ],
    [
      'compressor.release.maxValue',
      (c) => c.createDynamicsCompressor(),
      'release.maxValue',
    ],
    [
      'compressor.threshold.defaultValue',
      (c) => c.createDynamicsCompressor(),
      'threshold.defaultValue',
    ],
    [
      'compressor.threshold.minValue',
      (c) => c.createDynamicsCompressor(),
      'threshold.minValue',
    ],
    [
      'compressor.threshold.maxValue',
      (c) => c.createDynamicsCompressor(),
      'threshold.maxValue',
    ],

    // OscillatorNode
    [
      'oscillator.detune.defaultValue',
      (c) => c.createOscillator(),
      'detune.defaultValue',
    ],
    [
      'oscillator.detune.minValue',
      (c) => c.createOscillator(),
      'detune.minValue',
    ],
    [
      'oscillator.detune.maxValue',
      (c) => c.createOscillator(),
      'detune.maxValue',
    ],
    [
      'oscillator.frequency.defaultValue',
      (c) => c.createOscillator(),
      'frequency.defaultValue',
    ],
    [
      'oscillator.frequency.minValue',
      (c) => c.createOscillator(),
      'frequency.minValue',
    ],
    [
      'oscillator.frequency.maxValue',
      (c) => c.createOscillator(),
      'frequency.maxValue',
    ],

    // BiquadFilterNode
    [
      'biquad.frequency.defaultValue',
      (c) => c.createBiquadFilter(),
      'frequency.defaultValue',
    ],
    [
      'biquad.frequency.minValue',
      (c) => c.createBiquadFilter(),
      'frequency.minValue',
    ],
    [
      'biquad.frequency.maxValue',
      (c) => c.createBiquadFilter(),
      'frequency.maxValue',
    ],
    [
      'biquad.gain.defaultValue',
      (c) => c.createBiquadFilter(),
      'gain.defaultValue',
    ],
    ['biquad.gain.minValue', (c) => c.createBiquadFilter(), 'gain.minValue'],
    ['biquad.gain.maxValue', (c) => c.createBiquadFilter(), 'gain.maxValue'],
    ['biquad.Q.defaultValue', (c) => c.createBiquadFilter(), 'Q.defaultValue'],
    ['biquad.Q.minValue', (c) => c.createBiquadFilter(), 'Q.minValue'],
    ['biquad.Q.maxValue', (c) => c.createBiquadFilter(), 'Q.maxValue'],
    [
      'biquad.detune.defaultValue',
      (c) => c.createBiquadFilter(),
      'detune.defaultValue',
    ],

    // GainNode
    ['gain.gain.defaultValue', (c) => c.createGain(), 'gain.defaultValue'],
    ['gain.gain.minValue', (c) => c.createGain(), 'gain.minValue'],
    ['gain.gain.maxValue', (c) => c.createGain(), 'gain.maxValue'],

    // Context-level
    ['context.sampleRate', (c) => c.createGain(), '__ctx__sampleRate'],
  ];
}

function readPath(node: AudioNode, path: string): number | undefined {
  try {
    if (path === '__ctx__sampleRate') {
      // Special: read the context's sampleRate via the node's .context
      return (node.context as AudioContext | OfflineAudioContext).sampleRate;
    }
    const parts = path.split('.');
    let cur: any = node;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return typeof cur === 'number' ? cur : undefined;
  } catch {
    return undefined;
  }
}

function collectNodeConstants(): Record<string, number> {
  const out: Record<string, number> = {};
  let ctx: AudioContext | OfflineAudioContext | null = null;
  try {
    const OCx: typeof OfflineAudioContext | undefined =
      (globalThis as any).OfflineAudioContext ||
      (globalThis as any).webkitOfflineAudioContext;
    if (OCx) {
      ctx = new OCx(1, 1, 44100);
    } else {
      const AC: typeof AudioContext | undefined =
        (globalThis as any).AudioContext ||
        (globalThis as any).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (!ctx) return out;

    for (const [key, factory, path] of buildConstantProbes()) {
      try {
        const node = factory(ctx);
        const v = readPath(node, path);
        // Filter to DynamoDB-safe range. AudioParam.minValue / maxValue
        // commonly return Float32 spec limits (±3.4028234663852886e+38)
        // for Oscillator.detune, BiquadFilter.gain/detune, etc. — these
        // exceed Number.MAX_SAFE_INTEGER and the DDB marshaller rejects
        // them. Skipped values are spec-mandated (same across engines),
        // not discriminating, so no fingerprint loss.
        if (
          v != null &&
          Number.isFinite(v) &&
          v >= Number.MIN_SAFE_INTEGER &&
          v <= Number.MAX_SAFE_INTEGER
        ) {
          out[key] = v;
        }
      } catch {
        /* skip this probe */
      }
    }
  } catch {
    /* no audio API */
  }
  return out;
}

// ── sampleSum probe — classic rendered-sample fingerprint ─────────────

async function renderSampleSum(): Promise<{
  sum: number;
  reduction: number;
  failed: boolean;
}> {
  const OCx: typeof OfflineAudioContext | undefined =
    (globalThis as any).OfflineAudioContext ||
    (globalThis as any).webkitOfflineAudioContext;
  if (!OCx) return { sum: NaN, reduction: NaN, failed: true };

  try {
    const ctx = new OCx(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    osc.connect(compressor);
    compressor.connect(ctx.destination);
    osc.start(0);

    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    let sum = 0;
    // Sample range 4500..5000 keeps the sum value in fpjs's compatible
    // range (~120-130 on most CPUs) for cross-vendor comparability.
    for (let i = 4500; i < 5000; i++) {
      sum += Math.abs(data[i]);
    }
    return { sum, reduction: compressor.reduction, failed: false };
  } catch {
    return { sum: NaN, reduction: NaN, failed: true };
  }
}

export default async function getAudio(): Promise<
  AudioFingerprint | undefined
> {
  try {
    const timer = createTimer();
    timer.start();

    const hasOACtx = !!(
      (globalThis as any).OfflineAudioContext ||
      (globalThis as any).webkitOfflineAudioContext
    );

    const nodeConstants = collectNodeConstants();
    const { sum, reduction, failed } = hasOACtx
      ? await renderSampleSum()
      : { sum: NaN, reduction: NaN, failed: true };

    logTestResult({ time: timer.stop(), test: 'audio', passed: true });
    return {
      available: hasOACtx,
      sampleSum: sum,
      compressorReduction: reduction,
      nodeConstants,
      renderingFailed: failed,
    };
  } catch (error) {
    logTestResult({ test: 'audio', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
