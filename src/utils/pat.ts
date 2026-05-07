/**
 * PAT (Apple Private Access Token) probe.
 *
 * Fires a same-origin-style fetch against the API's /v1/pat-attestation
 * endpoint. iOS Safari (16+) auto-redeems the 401 + WWW-Authenticate
 * challenge at the OS level, transparent to JS — by the time fetch()
 * resolves, the body is the redeemed `{ token, expiryMs }` envelope.
 *
 * Loose-coupling contract: this module is the ONLY caller of the PAT
 * route. Returns an empty string for every failure mode (network,
 * non-2xx, malformed body, OS didn't redeem, non-Apple platform). Never
 * throws. Caller should treat empty string as "no signal" — the rest of
 * the integrity flow continues unchanged.
 */

const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * Fetch a PAT-derived sigint-format probe token from the API.
 *
 * @param endpoint Absolute URL of the PAT attestation route (e.g.
 *                 "https://api.argus.pw/v1/pat-attestation").
 * @param timeoutMs Hard cap on the entire fetch+OS-redemption round trip.
 * @returns The probe token string ready to forward as `payload.patToken`,
 *          or '' on any failure / non-Apple platform.
 */
export async function fetchPatToken(
  endpoint: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctl.signal,
    });
    if (!res.ok) return '';
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === 'string' ? body.token : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
