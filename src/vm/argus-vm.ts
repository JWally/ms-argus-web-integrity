/**
 * Argus-Web VM orchestrator.
 *
 * Ported from ms-argus-bio/src/vm/tripwire.ts.
 * Loads packed bytecode (see src/vm/unpack.ts), unpacks, runs async VM. The VM runs
 * sigint probes + ECDH encrypt + POST. Classification is server-side.
 *
 * Returns:
 *   - sessionId: returned by /v1/integrity-collect after successful POST
 *   - vm.timezone: timezone cross-validation data, for debug surfaces
 *   - submissionError: populated when sessionId is empty, for diagnosis
 */

import { decode } from './decoder';
import { executeAsync } from './interpreter';
import { unpack } from './unpack';
import { createArgusVmBridge } from './bridge';
import type { ArgusVmContext } from './bridge';
import {
  fetchH2Probe,
  extractEcdhPubkeyFromVersionHash,
  type SigintConfig,
} from '../utils/sigint';
import type { IntegrityResult } from '../integrity';

let bytecodeCache: { bytecode: string } | null = null;

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
    bytecodeCache = { bytecode: mod.VM_BYTECODE };
    return bytecodeCache;
  } catch {
    return null;
  }
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

export interface ArgusVmResult {
  sessionId: string;
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
  cpi?: string | null,
): Promise<ArgusVmResult> {
  const fallback: ArgusVmResult = {
    sessionId: '',
  };

  // Consume prefetch slot if available (started by prefetchArgusVm() before fingerprint collection),
  // otherwise start fresh now. _prefetchH2Slot stays live for bridge.ts to reuse.
  const prefetched = _prefetchSlot;
  _prefetchSlot = null;

  let modules: NonNullable<Awaited<ReturnType<typeof loadBytecodeModules>>>;
  let handshake: { serverPubKey: string; sessionToken: string };

  if (prefetched) {
    const result = await prefetched;
    if (!result) {
      console.warn('[argus-vm] prefetch slot resolved to null');
      return fallback;
    }
    modules = result.modules;
    handshake = result.handshake;
    console.log(
      '[argus-vm] prefetch consumed, pubkey length:',
      handshake.serverPubKey.length,
    );
  } else {
    // No prefetch slot — start fresh. Without sigintConfig there's no way
    // to obtain the server ECDH pubkey, so fail fast.
    if (!sigintConfig) {
      console.warn('[argus-vm] no prefetch slot and no sigintConfig');
      return fallback;
    }
    console.log('[argus-vm] starting fresh prefetch');
    const result = await prefetchArgusVm(sigintConfig);
    _prefetchSlot = null;
    if (!result) {
      console.warn('[argus-vm] fresh prefetch returned null');
      return fallback;
    }
    modules = result.modules;
    handshake = result.handshake;
    console.log(
      '[argus-vm] fresh prefetch done, pubkey length:',
      handshake.serverPubKey.length,
    );
  }

  try {
    const binary = await unpack(modules.bytecode);
    if (!binary) {
      console.warn('[argus-vm] bytecode unpack failed (stale blob?)');
      return fallback;
    }
    const mod = decode(binary.buffer as ArrayBuffer);

    let submissionError: string | null = null;
    const ctx: ArgusVmContext = {
      // Slice handlers in bridge.ts read from this; bytecode composes the
      // device object via 0x50-0x62 gets. Identifiers + meta are added by
      // GET_PAYLOAD_JSON which receives the assembled device as its first arg.
      fingerprint,
      cpi: cpi ?? null,
      getServerPubKey: () => handshake.serverPubKey,
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
      | { sessionId: string; publicKeyB64?: string }
      | undefined;

    if (!vmResult) return fallback;

    return {
      sessionId: vmResult.sessionId ?? '',
      ...(submissionError ? { submissionError } : {}),
    };
  } catch (err) {
    console.warn('[argus-vm] runArgusVm failed:', err);
    return fallback;
  }
}

/**
 * Run VM bytecode with an empty server-pubkey context — exercises the
 * interpreter without performing ECDH handshake, signing, or POST.
 *
 * The bytecode's main flow is gated on `serverPubKey.length > 0`; with an
 * empty string it short-circuits past the crypto-id signing, encryption,
 * and submission. Useful as a side-effect-free smoke test for the
 * decoder + interpreter from debug harnesses (e.g. simple.html). Returns
 * nothing meaningful — this exists for its side effect (running bytecode).
 *
 * `fingerprint` is required: bytecode unconditionally builds the device
 * object via slice gets, which would crash without it.
 */
export async function runVmDetection(
  fingerprint: IntegrityResult,
): Promise<void> {
  const mods = await loadBytecodeModules();
  if (!mods) return;

  try {
    const binary = await unpack(mods.bytecode);
    if (!binary) return;
    const mod = decode(binary.buffer as ArrayBuffer);

    const ctx: ArgusVmContext = {
      fingerprint,
      cpi: null,
      getServerPubKey: () => '', // no server key — skips ECDH + POST in bytecode
      apiEndpoint: '',
      sessionToken: '',
    };

    const bridge = createArgusVmBridge(ctx);
    await executeAsync(mod, bridge);
  } catch {
    /* debug harness — swallow errors */
  }
}
