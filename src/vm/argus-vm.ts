/**
 * Argus-Web VM orchestrator.
 *
 * Ported from ms-argus-bio/src/vm/tripwire.ts.
 * Loads XOR-scrambled bytecode, descrambles, runs async VM. The VM runs
 * sigint probes + ECDH encrypt + POST. Classification is server-side.
 *
 * Returns:
 *   - sessionId: returned by /v1/integrity-collect after successful POST
 *   - vm.timezone: timezone cross-validation data, for debug surfaces
 *   - submissionError: populated when sessionId is empty, for diagnosis
 */

import { decode } from './decoder';
import { executeAsync } from './interpreter';
import { createArgusVmBridge } from './bridge';
import type { ArgusVmContext } from './bridge';
import {
  fetchH2Probe,
  extractEcdhPubkeyFromVersionHash,
  type SigintConfig,
} from '../utils/sigint';
import type { IntegrityResult } from '../integrity';

let bytecodeCache: { bytecode: string; key: string } | null = null;

/** Module-level prefetch slot — populated by prefetchArgusVm(), consumed by runArgusVm() */
let _prefetchSlot: Promise<{
  modules: NonNullable<Awaited<ReturnType<typeof loadBytecodeModules>>>;
  handshake: { serverPubKey: string; sessionToken: string };
} | null> | null = null;

/**
 * H2-probe token prefetch slot — populated by prefetchArgusVm() when sigintConfig
 * is provided, passed to the bridge via ArgusVmContext to avoid a duplicate fetch.
 */
let _prefetchH2Slot: Promise<string> | null = null;

async function loadBytecodeModules() {
  if (bytecodeCache) return bytecodeCache;
  try {
    const mod = await import('./bytecode-modules');
    bytecodeCache = {
      bytecode: mod.VM_BYTECODE,
      key: mod.VM_KEY,
    };
    return bytecodeCache;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function xorDescramble(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Pre-warm: start bytecode load and h2-probe fetch immediately, before fingerprint
 * collection. The h2-probe response carries the server's ECDH public key — there is
 * no fallback key-retrieval path. Call this as early as possible.
 * runArgusVm() will consume the result automatically.
 */
type PrefetchResult = Promise<{
  modules: NonNullable<Awaited<ReturnType<typeof loadBytecodeModules>>>;
  handshake: { serverPubKey: string; sessionToken: string };
} | null>;

export function prefetchArgusVm(sigintConfig?: SigintConfig): PrefetchResult {
  _prefetchH2Slot = null;

  let slot: PrefetchResult;

  if (sigintConfig) {
    // Start h2-probe eagerly. Its response carries the server pubkey.
    // Also store the token promise for bridge.ts reuse.
    const h2Result = fetchH2Probe(sigintConfig)
      .then((r) => {
        const data = r.data;
        let token = '';
        let serverPubKey: string | null = null;
        if (data && typeof data === 'object' && 'token' in data) {
          token = (data as { token: string }).token;
          const vh = (data as { 'x-api-version-hash'?: string })[
            'x-api-version-hash'
          ];
          if (vh) serverPubKey = extractEcdhPubkeyFromVersionHash(vh);
        }
        return { token, serverPubKey };
      })
      .catch(() => ({ token: '', serverPubKey: null }));

    // Expose just the token string for bridge.ts to reuse (avoids a duplicate request)
    _prefetchH2Slot = h2Result.then((r) => r.token);

    slot = Promise.all([loadBytecodeModules(), h2Result]).then(
      ([modules, h2Data]) => {
        if (!modules || !h2Data.serverPubKey) return null;
        return {
          modules,
          handshake: {
            serverPubKey: h2Data.serverPubKey,
            sessionToken: crypto.randomUUID().replace(/-/g, ''),
          },
        };
      },
    );
  } else {
    // Without sigintConfig there's no way to obtain the server ECDH pubkey.
    slot = Promise.resolve(null);
  }

  _prefetchSlot = slot;
  return slot;
}

export interface VmTimezone {
  offset: number;
  offsetComputed: number;
  location: string;
  zone: string;
}

export interface ArgusVmResult {
  sessionId: string;
  vm: {
    timezone?: VmTimezone;
  };
  /**
   * If the ECDH POST failed, this carries a short diagnostic string
   * (e.g. "http_402_Payment_Required", "fetch_threw: network error").
   * Only set when sessionId is empty — caller can use it to surface a
   * useful error rather than reporting an opaque failure.
   */
  submissionError?: string;
}

/**
 * Run the argus-web VM.
 *
 * @param fingerprint - Collected fingerprint data to submit
 * @param apiBase - API base URL, e.g. "https://api.argus.pw"
 * @param sigintConfig - Optional sigint config for TCP/H2/TLS probes
 * @returns VM result including sessionId returned by the API
 */
export async function runArgusVm(
  fingerprint: IntegrityResult,
  apiBase: string,
  sigintConfig?: SigintConfig,
): Promise<ArgusVmResult> {
  const fallback: ArgusVmResult = {
    sessionId: '',
    vm: {},
  };

  // Consume prefetch slot if available (started by prefetchArgusVm() before fingerprint collection),
  // otherwise start fresh now. _prefetchH2Slot stays live for bridge.ts to reuse.
  const prefetched = _prefetchSlot;
  _prefetchSlot = null;

  let modules: NonNullable<Awaited<ReturnType<typeof loadBytecodeModules>>>;
  let handshake: { serverPubKey: string; sessionToken: string };

  if (prefetched) {
    const result = await prefetched;
    if (!result) { console.warn('[argus-vm] prefetch slot resolved to null'); return fallback; }
    modules = result.modules;
    handshake = result.handshake;
    console.log('[argus-vm] prefetch consumed, pubkey length:', handshake.serverPubKey.length);
  } else {
    // No prefetch slot — start fresh. Without sigintConfig there's no way
    // to obtain the server ECDH pubkey, so fail fast.
    if (!sigintConfig) { console.warn('[argus-vm] no prefetch slot and no sigintConfig'); return fallback; }
    console.log('[argus-vm] starting fresh prefetch');
    const result = await prefetchArgusVm(sigintConfig);
    _prefetchSlot = null;
    if (!result) { console.warn('[argus-vm] fresh prefetch returned null'); return fallback; }
    modules = result.modules;
    handshake = result.handshake;
    console.log('[argus-vm] fresh prefetch done, pubkey length:', handshake.serverPubKey.length);
  }

  try {
    const scrambled = base64ToBytes(modules.bytecode);
    const key = hexToBytes(modules.key);
    const binary = xorDescramble(scrambled, key);
    const mod = decode(binary.buffer as ArrayBuffer);

    let submissionError: string | null = null;
    const ctx: ArgusVmContext = {
      getPayload: () => {
        return {
          identifiers: {
            session_id: crypto.randomUUID(),
          },
          device: {
            css: fingerprint.css,
            engine: fingerprint.engine,
            math: fingerprint.math,
            headless: fingerprint.headless,
            lies: fingerprint.lies,
            trash: fingerprint.trash,
            shielding: fingerprint.shielding,
            incognito: fingerprint.incognito,
            intl: fingerprint.intl,
            navigator: fingerprint.navigator,
            screen: fingerprint.screen,
            status: fingerprint.status,
            timezone: fingerprint.timezone,
            timing: fingerprint.timing,
            cssMedia: fingerprint.cssMedia,
            webrtc: fingerprint.webrtc,
            windowPrefixes: fingerprint.windowPrefixes,
            workerScope: fingerprint.workerScope,
            errors: fingerprint.errors,
          },
          meta: fingerprint.meta,
        } as unknown as Record<string, unknown>;
      },
      getStableHash: () => '',
      getServerPubKey: () => handshake.serverPubKey,
      onImmolate: () => {
        /* no-op — tamper flagging was removed with the dead wire fields.
         * Bridge API IMMOLATE (0x15) stays registered but is not called
         * from bytecode. Reintroduce via the crypto-id replacement if a
         * client-side tamper signal is wanted on the wire. */
      },
      sigintConfig,
      apiEndpoint: `${apiBase}/v1/integrity-collect`,
      sessionToken: handshake.sessionToken,
      h2Promise: _prefetchH2Slot ?? undefined,
      onSubmissionError: (detail) => {
        submissionError = detail;
      },
    };
    const bridge = createArgusVmBridge(ctx);

    const result = await executeAsync(mod, bridge);

    const vmResult = result.value as
      | {
          sessionId: string;
          publicKeyB64?: string;
          vm?: ArgusVmResult['vm'];
        }
      | undefined;

    if (!vmResult) return fallback;

    return {
      sessionId: vmResult.sessionId ?? '',
      vm: vmResult.vm ?? {},
      ...(submissionError ? { submissionError } : {}),
    };
  } catch (err) {
    console.warn('[argus-vm] runArgusVm failed:', err);
    return fallback;
  }
}

/**
 * Run VM bytecode only — no sigint, no server POST.
 *
 * Historical purpose: validate parity between the JS detection modules
 * and the VM bytecode's in-VM detection. The bytecode no longer runs
 * detection (classification is server-side), so this is effectively a
 * dormant utility — the returned `vm` slot is populated by the bridge's
 * timezone cross-validation captures even without network access.
 *
 * Kept exported so simple.html (debug harness) and any future in-VM
 * detection work have a side-effect-free way to exercise the bytecode.
 */
export async function runVmDetection(
  fingerprint?: IntegrityResult,
): Promise<{ vm: ArgusVmResult['vm'] }> {
  const fallback = { vm: {} as ArgusVmResult['vm'] };

  const mods = await loadBytecodeModules();
  if (!mods) return fallback;

  try {
    const scrambled = base64ToBytes(mods.bytecode);
    const key = hexToBytes(mods.key);
    const binary = xorDescramble(scrambled, key);
    const mod = decode(binary.buffer as ArrayBuffer);

    const ctx: ArgusVmContext = {
      getPayload: () => ({}),
      getStableHash: () => '',
      getServerPubKey: () => '', // no server key — skips ECDH + POST in bytecode
      onImmolate: () => {},
      apiEndpoint: '',
      sessionToken: '',
    };

    const bridge = createArgusVmBridge(ctx);
    const result = await executeAsync(mod, bridge);

    const vmResult = result.value as { vm?: ArgusVmResult['vm'] } | undefined;

    if (!vmResult) return fallback;

    return {
      vm: vmResult.vm ?? {},
    };
  } catch {
    return fallback;
  }
}
