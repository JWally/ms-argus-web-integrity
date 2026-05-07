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
 */

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
}

const EMPTY: PatProbeResult = {
  token: '',
  status: 0,
  ok: false,
  hasToken: false,
};

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
    try {
      const body = (await res.json()) as { token?: unknown };
      if (typeof body.token === 'string' && body.token.length > 0) {
        token = body.token;
        hasToken = true;
      }
    } catch {
      /* body not parseable as JSON — token stays empty */
    }
    return { token, status: res.status, ok: res.ok, hasToken };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...EMPTY, err: msg.slice(0, 64) };
  } finally {
    clearTimeout(timer);
  }
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
  return JSON.stringify(out);
}
