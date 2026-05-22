/**
 * PAT (Apple Private Access Token) probe.
 *
 * Fires a same-origin-style fetch against the API's /v1/pat-attestation
 * endpoint. iOS Safari (16+) auto-redeems the 401 + WWW-Authenticate
 * challenge at the OS level, transparent to JS — by the time fetch()
 * resolves, the body should be the redeemed `{ token, … }` envelope.
 *
 * In cross-origin contexts, however, what JS actually receives after the
 * OS-level redemption is unclear. `fetchPatProbe` therefore captures the
 * full observable state — status, ok, body shape, exception — and returns
 * it as `PatProbeResult`. The bridge surfaces both `token` (for the
 * server-trusted attestation field) and a stringified diag (for our
 * forensic field).
 *
 * Loose-coupling contract: never throws. Empty token + diag fields on
 * any failure mode (network, non-2xx, malformed body, non-Apple OS).
 *
 * sessionStorage cache JSON round-tripping uses the iframe-pristine
 * `JSON.stringify` / `parse` (CASTLE-TO-ARGUS.md §3.14 bullet E).
 */

import { getPristineRefs } from './pristine-iframe';

const DEFAULT_TIMEOUT_MS = 4_000;

/** Diagnostic snapshot of what `fetch()` saw when the SDK probed PAT. */
export interface PatProbeResult {
  /** Server-signed attestation blob; empty string when iOS didn't redeem. */
  token: string;
  /** HTTP status JS saw on the resolved response. 0 on network/abort error. */
  status: number;
  /** res.ok (200–299). Mirrors `status` semantics. */
  ok: boolean;
  /** True if the resolved body had a non-empty `token` field. */
  hasToken: boolean;
  /** Short exception message when fetch rejected. Truncated to 64 chars. */
  err?: string;
  /** Server-supplied client-refresh trigger (epoch seconds). When set, the
   *  SDK should reuse this token until `nowSec >= exp`. Always strictly
   *  less than the server's hard expiry baked into the signed token. */
  exp?: number;
}

const EMPTY: PatProbeResult = {
  token: '',
  status: 0,
  ok: false,
  hasToken: false,
};

const CACHE_KEY = 'argus.pat.v1';

interface CachedToken {
  exp: number; // epoch seconds; matches what the server returned
  token: string;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Best-effort sessionStorage access — silently no-op in environments where
 *  it's missing (SSR, sandboxed iframes, private modes that throw on
 *  setItem, etc.). */
function readCache(): CachedToken | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = getPristineRefs().parse(raw) as Partial<CachedToken>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.exp !== 'number' ||
      parsed.token.length === 0
    ) {
      return null;
    }
    return { exp: parsed.exp, token: parsed.token };
  } catch {
    return null;
  }
}

function writeCache(c: CachedToken): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(CACHE_KEY, getPristineRefs().stringify(c));
  } catch {
    /* quota / private mode / disabled storage — silently skip */
  }
}

function clearCache(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to do */
  }
}

export async function fetchPatProbe(
  endpoint: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<PatProbeResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctl.signal,
    });
    let token = '';
    let hasToken = false;
    let exp: number | undefined;
    try {
      const body = (await res.json()) as { token?: unknown; exp?: unknown };
      if (typeof body.token === 'string' && body.token.length > 0) {
        token = body.token;
        hasToken = true;
      }
      if (typeof body.exp === 'number') {
        exp = body.exp;
      }
    } catch {
      /* body not parseable as JSON — token stays empty */
    }
    return { token, status: res.status, ok: res.ok, hasToken, exp };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...EMPTY, err: msg.slice(0, 64) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache-aware PAT probe. Checks sessionStorage for a non-expired token
 * from a previous fetch; uses it if found, otherwise hits the network.
 * Cache entries persist for the duration of the browser tab and survive
 * SPA route changes / soft reloads, defeating iOS's per-origin PAT
 * cooldown without forcing a fresh redemption on every page.
 *
 * The cache is opportunistic: any sessionStorage failure (private mode,
 * quota, missing API) silently falls back to a direct network fetch.
 */
export async function getPatToken(
  endpoint: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<PatProbeResult> {
  const cached = readCache();
  if (cached && cached.exp > nowSec()) {
    return {
      token: cached.token,
      status: 200,
      ok: true,
      hasToken: true,
      exp: cached.exp,
    };
  }
  if (cached) {
    // expired — clean it up rather than letting it linger
    clearCache();
  }
  const result = await fetchPatProbe(endpoint, timeoutMs);
  if (result.token && result.exp) {
    writeCache({ exp: result.exp, token: result.token });
  }
  return result;
}

/**
 * Stable JSON snapshot of a probe result, suitable for posting to the
 * integrity-collect payload as a top-level forensic field. Token field
 * is intentionally NOT included here — it has its own (server-trusted)
 * route via the patToken field; this string is for diagnostics only.
 */
export function diagString(r: PatProbeResult): string {
  const out: Record<string, unknown> = {
    status: r.status,
    ok: r.ok,
    hasToken: r.hasToken,
  };
  if (r.err) out.err = r.err;
  return getPristineRefs().stringify(out);
}
