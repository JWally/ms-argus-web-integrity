/**
 * Module-worker import-chain CDP timing bench.
 *
 * Classic and module workers share startup/isolate costs. Module workers
 * with blob imports add per-import fetch + script-parse work, which is
 * amplified when CDP has Network/Debugger agents attached. The normalized
 * module-classic gap is positive-only CDP residue.
 */

import { IS_BLINK } from '../utils/helpers';

import type { WorkerModuleImportChainTiming } from './types';

const N_LEAVES = 20;
// 15 reps (was 5): on noisy headless/SwiftShader hosts the per-spawn cost
// swings ~4x, so a 5-sample median occasionally lands a cheap run on both
// axes at once (low per_import AND low ratio) and a real CDP session reads
// as real-shaped (observed: 1 of 8 Chromium CDP sessions escaped). A
// 15-sample median damps that variance without moving any threshold (no FP
// risk on slow real phones). ~32 sequential spawns, all in the hidden
// iframe's worker realm — adds <1s to a multi-second scan.
const N_REPS = 15;
const SPAWN_TIMEOUT_MS = 1200;
// Headroom for 15 reps so the probe completes instead of clipping to
// undefined (no signal) on slow hosts: ~32 spawns * worst-case ~70ms + warmup.
const TOTAL_TIMEOUT_MS = 5000;

const PER_IMPORT_THRESHOLD_US = 320;
const RATIO_THRESHOLD = 2.6;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number {
  return values[Math.floor(values.length / 2)];
}

function spawnAndTime(src: string, opts?: WorkerOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    let url: string | null = null;
    let worker: Worker | null = null;
    let settled = false;

    const settle = (err?: unknown, value?: number) => {
      if (settled) return;
      settled = true;
      try {
        worker?.terminate();
      } catch {
        /* no worker to terminate */
      }
      try {
        if (url) URL.revokeObjectURL(url);
      } catch {
        /* createObjectURL/revokeObjectURL may be patched or blocked */
      }
      if (err) reject(err);
      else resolve(value ?? 0);
    };

    const timer = setTimeout(
      () => settle(new Error('worker_timeout')),
      SPAWN_TIMEOUT_MS,
    );

    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const t0 = performance.now();
      worker = new Worker(url, opts);
      worker.onmessage = () => {
        clearTimeout(timer);
        settle(undefined, performance.now() - t0);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        settle(new Error('worker_error'));
      };
    } catch (err) {
      clearTimeout(timer);
      settle(err);
    }
  });
}

export default function getWorkerModuleImportChain(): Promise<
  WorkerModuleImportChainTiming | undefined
> {
  return new Promise((resolve) => {
    if (!IS_BLINK || typeof Worker !== 'function') return resolve(undefined);
    if (
      typeof Blob !== 'function' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return resolve(undefined);
    }

    let settled = false;
    const leafUrls: string[] = [];

    const settle = (value: WorkerModuleImportChainTiming | undefined) => {
      if (settled) return;
      settled = true;
      for (const url of leafUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* cleanup best effort */
        }
      }
      resolve(value);
    };

    const totalTimer = setTimeout(() => settle(undefined), TOTAL_TIMEOUT_MS);

    (async () => {
      try {
        for (let i = 0; i < N_LEAVES; i++) {
          const blob = new Blob([`export const v=${i};`], {
            type: 'text/javascript',
          });
          leafUrls.push(URL.createObjectURL(blob));
        }

        const imports = leafUrls
          .map((url, i) => `import {v as v${i}} from "${url}";`)
          .join('\n');
        const sum = Array.from({ length: N_LEAVES }, (_, i) => `v${i}`).join(
          '+',
        );
        const moduleSrc = `${imports}\npostMessage(${sum});`;
        const classicTotal = Array.from(
          { length: N_LEAVES },
          (_, i) => i,
        ).reduce((a, b) => a + b, 0);
        const classicSrc = `postMessage(${classicTotal});`;

        await spawnAndTime(classicSrc);
        await spawnAndTime(moduleSrc, { type: 'module' });

        const classicTimes: number[] = [];
        const moduleTimes: number[] = [];
        for (let i = 0; i < N_REPS; i++) {
          classicTimes.push(await spawnAndTime(classicSrc));
          moduleTimes.push(await spawnAndTime(moduleSrc, { type: 'module' }));
        }

        classicTimes.sort((a, b) => a - b);
        moduleTimes.sort((a, b) => a - b);

        const classicP50 = median(classicTimes);
        const moduleP50 = median(moduleTimes);
        const delta = moduleP50 - classicP50;
        const perImportUs = (delta * 1000) / N_LEAVES;
        const ratio = classicP50 > 0 ? moduleP50 / classicP50 : null;

        clearTimeout(totalTimer);
        settle({
          leaves: N_LEAVES,
          reps: N_REPS,
          classic_p50_ms: round2(classicP50),
          module_p50_ms: round2(moduleP50),
          delta_ms: round2(delta),
          per_import_us: round2(perImportUs),
          ratio: ratio == null ? null : round2(ratio),
          cdp_shaped:
            perImportUs > PER_IMPORT_THRESHOLD_US ||
            (ratio != null && ratio > RATIO_THRESHOLD),
        });
      } catch {
        clearTimeout(totalTimer);
        settle(undefined);
      }
    })().catch(() => {
      clearTimeout(totalTimer);
      settle(undefined);
    });
  });
}
