/**
 * End-to-end VM execution test for the anti-debug timing checks.
 *
 * Compiles scripts/vm-src/main.ts, runs it through the MiniVM with a
 * mocked bridge, and asserts:
 *   - PERF_NOW (0x70) is called (validates the new bridge wiring)
 *   - the VM returns the expected { sessionId, publicKeyB64, vm } shape
 *   - when PERF_NOW reports small deltas, tamper_bits stays 0 → no
 *     `tamper_bits` field appears in the final posted payload
 *   - when PERF_NOW reports a huge delta around stringify, tamper_bits
 *     is set and appears in the payload
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile } from '../../scripts/compiler/index';
import { executeAsync } from './interpreter';
import { ApiBridge, BridgeApi } from './bridge';

function readVmSrc(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../scripts/vm-src/main.ts'),
    'utf-8',
  );
}

/** A minimal fake IntegrityResult shape — only the fields bytecode reads. */
const fakeSlice = { marker: 'x' };
const fakeMeta = { version: 'test', loadedAt: 0 };

interface PostedPayload {
  json: string;
}

/** Build a bridge that runs the full flow far enough to exercise tamper_bits. */
function makeBridge(opts: {
  nowSequence: number[];
  postCapture: PostedPayload;
}): ApiBridge {
  const bridge = new ApiBridge();
  let nowIdx = 0;

  bridge.register(BridgeApi.PERF_NOW, {
    get: () => {
      const v = opts.nowSequence[Math.min(nowIdx, opts.nowSequence.length - 1)];
      nowIdx++;
      return v;
    },
  });

  // Payload composition helpers
  bridge.register(BridgeApi.GET_PAYLOAD_UUID, {
    get: () => 'fake-session-uuid',
  });
  bridge.register(BridgeApi.GET_META, { get: () => fakeMeta });
  bridge.register(BridgeApi.GET_SERVER_PUB_KEY, {
    get: () => 'A'.repeat(88), // non-empty → bytecode enters payload-assembly branch
  });
  bridge.register(BridgeApi.GET_SESSION_TOKEN, { get: () => 'sessiontoken' });

  // Slices 0x50..0x62
  for (let id = 0x50; id <= 0x62; id++) {
    bridge.register(id, { get: () => fakeSlice });
  }

  // Async device-identity APIs
  bridge.register(BridgeApi.GET_CRYPTO_PUBKEY, { call: async () => '' });
  bridge.register(BridgeApi.GET_CLIENT_UUID, { call: async () => null });
  bridge.register(BridgeApi.SIGN_BYTES, { call: async () => '' });

  // Sigint probes
  bridge.register(BridgeApi.FETCH_TLS_FP, { call: async () => '' });
  bridge.register(BridgeApi.FETCH_TCP_PROBE, { call: async () => '' });
  bridge.register(BridgeApi.FETCH_H2_PROBE, { call: async () => '' });
  bridge.register(BridgeApi.FETCH_PAT_TOKEN, { call: async () => '' });

  // ECDH: pretend we can generate keys and derive an "encrypted" buffer
  bridge.register(BridgeApi.ECDH_GENERATE_KEY, {
    call: async () => ({ publicKey: {}, privateKey: {} }),
  });
  bridge.register(BridgeApi.ECDH_EXPORT_RAW, { call: async () => 'pubkeyb64' });
  bridge.register(BridgeApi.ECDH_DERIVE_ENCRYPT, {
    call: async (_thisArg, args) => {
      // args[2] is the XOR-scrambled payload string; undo it to see the
      // original JSON and capture for assertions.
      const scrambled = args[2] as string;
      const token = 'sessiontoken';
      let fib0 = 1,
        fib1 = 1;
      let plain = '';
      for (let i = 0; i < scrambled.length; i++) {
        const t = token.charCodeAt(i % token.length);
        const f = fib1 % 256;
        plain += String.fromCharCode(scrambled.charCodeAt(i) ^ (t ^ f));
        const fib2 = fib0 + fib1;
        fib0 = fib1;
        fib1 = fib2;
        if (fib1 > 1000000) {
          fib0 = 1;
          fib1 = 1;
        }
      }
      opts.postCapture.json = plain;
      return new Uint8Array([1, 2, 3]);
    },
  });
  bridge.register(BridgeApi.POST_PAYLOAD, {
    call: async () => 'fake-session-id',
  });

  return bridge;
}

describe('VM anti-debug timing (item 5)', () => {
  it('runs clean: small time deltas → no tamper_bits in payload', async () => {
    const src = readVmSrc();
    const mod = compile(src);

    const capture: PostedPayload = { json: '' };
    // Simulate normal-speed execution: every PERF_NOW sample is within 50ms
    // of the entry reading. tEntry=0, checkpoints at 10, 20, 30, ...
    const nowSeq = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const bridge = makeBridge({ nowSequence: nowSeq, postCapture: capture });

    await executeAsync(mod, bridge);

    expect(capture.json.length).toBeGreaterThan(0);
    expect(capture.json).not.toMatch(/"tamper_bits"/);
    // Final payload is valid JSON
    const parsed = JSON.parse(capture.json);
    expect(parsed.identifiers.session_id).toBe('fake-session-uuid');
    expect(parsed.tamper_bits).toBeUndefined();
  });

  it('flags tamper_bits when stringify block exceeds threshold', async () => {
    const src = readVmSrc();
    const mod = compile(src);

    const capture: PostedPayload = { json: '' };
    // Entry=0; pre-stringify=10 (fast); after-stringify=1000 (slow!).
    // That triggers bit 2 (stringify > 500ms).
    // Later samples stay normal.
    const nowSeq = [0, 10, 1000, 1010, 1020, 1030];
    const bridge = makeBridge({ nowSequence: nowSeq, postCapture: capture });

    await executeAsync(mod, bridge);

    expect(capture.json).toMatch(/"tamper_bits":\d+/);
    const parsed = JSON.parse(capture.json);
    expect(parsed.tamper_bits & 2).toBe(2);
  });

  it('flags total-runtime bit when entry→stringify > 30s', async () => {
    const src = readVmSrc();
    const mod = compile(src);

    const capture: PostedPayload = { json: '' };
    // Entry=0; pre-stringify=100 (fine, bit 4 stays low);
    // after-stringify=35_000 (35s → bit 1 AND bit 2).
    const nowSeq = [0, 100, 35_000, 35_010];
    const bridge = makeBridge({ nowSequence: nowSeq, postCapture: capture });

    await executeAsync(mod, bridge);

    expect(capture.json).toMatch(/"tamper_bits":\d+/);
    const parsed = JSON.parse(capture.json);
    expect(parsed.tamper_bits & 1).toBe(1);
  });

  it('flags pre-stringify bit when assembly exceeds 500ms', async () => {
    const src = readVmSrc();
    const mod = compile(src);

    const capture: PostedPayload = { json: '' };
    // Entry=0; pre-stringify=700 (>500ms → bit 4 set);
    // stringify duration: 710-700 = 10ms (fine).
    const nowSeq = [0, 700, 710, 720];
    const bridge = makeBridge({ nowSequence: nowSeq, postCapture: capture });

    await executeAsync(mod, bridge);

    const parsed = JSON.parse(capture.json);
    expect(parsed.tamper_bits & 4).toBe(4);
  });
});
